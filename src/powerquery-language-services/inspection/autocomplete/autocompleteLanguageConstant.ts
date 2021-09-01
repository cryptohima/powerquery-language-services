// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as PQP from "@microsoft/powerquery-parser";

import { Assert, ResultUtils } from "@microsoft/powerquery-parser";
import { Ast, Constant } from "@microsoft/powerquery-parser/lib/powerquery-parser/language";
import { AncestryUtils, TXorNode, XorNode } from "@microsoft/powerquery-parser/lib/powerquery-parser/parser";

import type { Position } from "vscode-languageserver-types";
import { PositionUtils } from "../..";
import { ActiveNode, ActiveNodeUtils, TMaybeActiveNode } from "../activeNode";
import { AutocompleteItem, AutocompleteItemUtils } from "./autocompleteItem";
import { TriedAutocompleteLanguageConstant } from "./commonTypes";

export function tryAutocompleteLanguageConstant(
    settings: PQP.CommonSettings,
    maybeActiveNode: TMaybeActiveNode,
): TriedAutocompleteLanguageConstant {
    return ResultUtils.ensureResult(settings.locale, () => {
        return autocompleteLanguageConstant(maybeActiveNode);
    });
}

function autocompleteLanguageConstant(maybeActiveNode: TMaybeActiveNode): AutocompleteItem | undefined {
    if (!ActiveNodeUtils.isPositionInBounds(maybeActiveNode)) {
        return undefined;
    }
    const activeNode: ActiveNode = maybeActiveNode;

    if (isNullableAllowed(activeNode)) {
        return AutocompleteItemUtils.createFromLanguageConstantKind(Constant.LanguageConstantKind.Nullable);
    } else if (isOptionalAllowed(activeNode)) {
        return AutocompleteItemUtils.createFromLanguageConstantKind(Constant.LanguageConstantKind.Optional);
    } else {
        return undefined;
    }
}

function isNullableAllowed(activeNode: ActiveNode): boolean {
    const ancestry: ReadonlyArray<TXorNode> = activeNode.ancestry;
    const numAncestors: number = ancestry.length;

    for (let index: number = 0; index < numAncestors; index += 1) {
        const xorNode: TXorNode = ancestry[index];

        switch (xorNode.node.kind) {
            case Ast.NodeKind.AsNullablePrimitiveType:
                if (isNullableAllowedForAsNullablePrimitiveType(activeNode, index)) {
                    return true;
                }
                break;

            case Ast.NodeKind.PrimitiveType:
                if (isNullableAllowedForPrimitiveType(xorNode)) {
                    return true;
                }
                break;

            default:
                continue;
        }
    }

    return false;
}

function isNullableAllowedForAsNullablePrimitiveType(activeNode: ActiveNode, ancestryIndex: number): boolean {
    const maybeChild: TXorNode | undefined = AncestryUtils.maybePreviousXor(activeNode.ancestry, ancestryIndex);
    if (maybeChild?.node.maybeAttributeIndex !== 1) {
        return false;
    }
    // Ast.AsNullablePrimitiveType.paired: Ast.TNullablePrimitiveType
    const paired: TXorNode = maybeChild;
    const position: Position = activeNode.position;

    // Ast.PrimitiveType
    if (paired.node.kind === Ast.NodeKind.PrimitiveType && PositionUtils.isBeforeXor(position, paired, false)) {
        return true;
    }
    // Ast.NullablePrimitiveType
    else if (paired.node.kind === Ast.NodeKind.NullablePrimitiveType) {
        const maybeGrandchild: TXorNode | undefined = AncestryUtils.maybeNthPreviousXor(
            activeNode.ancestry,
            ancestryIndex,
            2,
        );
        if (maybeGrandchild === undefined) {
            return false;
        }
        // Ast.Constant || Ast.PrimitiveType
        const grandchild: TXorNode = maybeGrandchild;

        return (
            // Ast.Constant
            grandchild.node.kind === Ast.NodeKind.Constant ||
            // before Ast.PrimitiveType
            PositionUtils.isBeforeXor(position, grandchild, false)
        );
    } else if (paired.node.kind === Ast.NodeKind.PrimitiveType) {
        return isNullableAllowedForPrimitiveType(paired);
    } else {
        return false;
    }
}

function isNullableAllowedForPrimitiveType(primitiveType: TXorNode): boolean {
    return primitiveType.kind === PQP.Parser.XorNodeKind.Context;
}

function isOptionalAllowed(activeNode: ActiveNode): boolean {
    const maybeFnExprAncestryIndex: number | undefined = AncestryUtils.maybeFirstIndexOfNodeKind(
        activeNode.ancestry,
        Ast.NodeKind.FunctionExpression,
    );
    if (maybeFnExprAncestryIndex === undefined) {
        return false;
    }
    const fnExprAncestryIndex: number = maybeFnExprAncestryIndex;

    // FunctionExpression -> IParenthesisWrapped -> ParameterList -> Csv -> Parameter
    const maybeParameter: XorNode<Ast.TParameter> | undefined = AncestryUtils.maybeNthPreviousXorChecked<
        Ast.TParameter
    >(activeNode.ancestry, fnExprAncestryIndex, 4, Ast.NodeKind.Parameter);
    if (maybeParameter === undefined) {
        return false;
    }

    const maybeChildOfParameter: TXorNode | undefined = AncestryUtils.maybeNthPreviousXor(
        activeNode.ancestry,
        fnExprAncestryIndex,
        5,
    );
    if (maybeChildOfParameter === undefined) {
        return true;
    }
    const childOfParameter: TXorNode = maybeChildOfParameter;

    switch (childOfParameter.node.maybeAttributeIndex) {
        // IParameter.maybeOptionalConstant
        case 0:
            return true;

        // IParameter.name
        case 1:
            switch (childOfParameter.kind) {
                case PQP.Parser.XorNodeKind.Ast: {
                    const nameAst: Ast.Identifier = childOfParameter.node as Ast.Identifier;
                    const name: string = nameAst.literal;

                    return (
                        Constant.LanguageConstantKind.Optional.startsWith(name) &&
                        name !== Constant.LanguageConstantKind.Optional &&
                        PositionUtils.isInAst(activeNode.position, nameAst, false, true)
                    );
                }

                case PQP.Parser.XorNodeKind.Context:
                    return true;

                default:
                    throw Assert.isNever(childOfParameter);
            }

        default:
            return false;
    }
}
