// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as PQP from "@microsoft/powerquery-parser";

import { Ast, Type, TypeUtils } from "@microsoft/powerquery-parser/lib/powerquery-parser/language";
import {
    NodeIdMapIterator,
    NodeIdMapUtils,
    TXorNode,
    XorNodeUtils,
} from "@microsoft/powerquery-parser/lib/powerquery-parser/parser";

import { InspectTypeState, inspectXor } from "./common";

export function inspectTypeFieldProjection(state: InspectTypeState, xorNode: TXorNode): Type.TPowerQueryType {
    state.settings.maybeCancellationToken?.throwIfCancelled();
    XorNodeUtils.assertIsNodeKind<Ast.FieldProjection>(xorNode, Ast.NodeKind.FieldProjection);

    const projectedFieldNames: ReadonlyArray<string> = NodeIdMapIterator.iterFieldProjectionNames(
        state.nodeIdMapCollection,
        xorNode,
    );
    const previousSibling: TXorNode = NodeIdMapUtils.assertGetRecursiveExpressionPreviousSibling(
        state.nodeIdMapCollection,
        xorNode.node.id,
    );
    const previousSiblingType: Type.TPowerQueryType = inspectXor(state, previousSibling);
    const isOptional: boolean =
        NodeIdMapUtils.maybeUnboxNthChildIfAstChecked(
            state.nodeIdMapCollection,
            xorNode.node.id,
            3,
            Ast.NodeKind.Constant,
        ) !== undefined;

    return inspectFieldProjectionHelper(previousSiblingType, projectedFieldNames, isOptional);
}

function inspectFieldProjectionHelper(
    previousSiblingType: Type.TPowerQueryType,
    projectedFieldNames: ReadonlyArray<string>,
    isOptional: boolean,
): Type.TPowerQueryType {
    switch (previousSiblingType.kind) {
        case Type.TypeKind.Any: {
            const projectedFields: Type.UnorderedFields = new Map(
                projectedFieldNames.map((fieldName: string) => [fieldName, Type.AnyInstance]),
            );

            return {
                kind: Type.TypeKind.Any,
                maybeExtendedKind: Type.ExtendedTypeKind.AnyUnion,
                isNullable: previousSiblingType.isNullable,
                unionedTypePairs: [
                    {
                        kind: Type.TypeKind.Record,
                        maybeExtendedKind: Type.ExtendedTypeKind.DefinedRecord,
                        isNullable: previousSiblingType.isNullable,
                        fields: projectedFields,
                        isOpen: false,
                    },
                    {
                        kind: Type.TypeKind.Table,
                        maybeExtendedKind: Type.ExtendedTypeKind.DefinedTable,
                        isNullable: previousSiblingType.isNullable,
                        fields: new PQP.OrderedMap([...projectedFields]),
                        isOpen: false,
                    },
                ],
            };
        }

        case Type.TypeKind.Record:
        case Type.TypeKind.Table: {
            // All we know is previousSibling was a Record/Table.
            // Create a DefinedRecord/DefinedTable with the projected fields.
            if (TypeUtils.isDefinedRecord(previousSiblingType)) {
                return reducedFieldsToKeys(previousSiblingType, projectedFieldNames, isOptional, reducedRecordFields);
            } else if (TypeUtils.isDefinedTable(previousSiblingType)) {
                return reducedFieldsToKeys(previousSiblingType, projectedFieldNames, isOptional, reducedTableFields);
            } else {
                const newFields: Map<string, Type.TPowerQueryType> = new Map(
                    projectedFieldNames.map((fieldName: string) => [fieldName, Type.AnyInstance]),
                );
                return previousSiblingType.kind === Type.TypeKind.Record
                    ? TypeUtils.createDefinedRecord(false, newFields, false)
                    : TypeUtils.createDefinedTable(false, new PQP.OrderedMap([...newFields]), false);
            }
        }

        default:
            return Type.NoneInstance;
    }
}

// Returns a subset of `current` using `keys`.
// If a mismatch is found it either returns Null if isOptional, else None.
function reducedFieldsToKeys<T extends Type.DefinedRecord | Type.DefinedTable>(
    current: T,
    keys: ReadonlyArray<string>,
    isOptional: boolean,
    createFieldsFn: (
        current: T,
        keys: ReadonlyArray<string>,
    ) => T extends Type.DefinedRecord ? Type.UnorderedFields : Type.OrderedFields,
): T | Type.None | Type.Null {
    const currentFieldNames: ReadonlyArray<string> = [...current.fields.keys()];

    if (!current.isOpen && !PQP.ArrayUtils.isSubset(currentFieldNames, keys)) {
        return isOptional ? Type.NullInstance : Type.NoneInstance;
    }

    return {
        ...current,
        fields: createFieldsFn(current, keys),
        isOpen: false,
    };
}

function reducedRecordFields(current: Type.DefinedRecord, keys: ReadonlyArray<string>): Type.UnorderedFields {
    return PQP.MapUtils.pick(current.fields, keys);
}

function reducedTableFields(current: Type.DefinedTable, keys: ReadonlyArray<string>): Type.OrderedFields {
    return new PQP.OrderedMap([...PQP.MapUtils.pick(current.fields, keys).entries()]);
}
