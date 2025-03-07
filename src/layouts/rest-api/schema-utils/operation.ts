import type { Endpoint } from "./endpoint";
import {
  bakeProperties,
  type TypeDef,
  type Property,
  getTypeDefByRef,
  followRef,
} from "./type-def";

export interface Operation {
  operationId?: string | undefined;
  title?: string | undefined;
  summary?: string | undefined;
  description?: string | undefined;
  requestBody?:
    | { content: { "application/json": { schema: TypeDef } } }
    | undefined;
  parameters?: Parameter[] | undefined;
  responses: { [statusCode: number]: Response };
  tags?: string[] | undefined;
  deprecated?: boolean | undefined;
  "x-portone-title"?: string | undefined;
  "x-portone-summary"?: string | undefined;
  "x-portone-description"?: string | undefined;
  "x-portone-unstable"?: boolean | undefined;
  "x-portone-category"?: string | undefined;
}

export interface Parameter extends Property {
  name: string;
  in?: string | undefined; // formData, path, query
  required?: boolean | undefined;
  schema?: TypeDef | undefined;
}

export interface Response {
  description?: string | undefined;
  schema?: TypeDef | undefined;
  content?: { "application/json": { schema: TypeDef } };
}

export function getOperation(
  schema: any,
  { path, method }: Endpoint
): Operation {
  return schema.paths[path][method];
}

export function getPathParameters(operation: Operation): Parameter[] {
  return operation.parameters?.filter((p) => p.in === "path") || [];
}

export function getQueryParameters(operation: Operation): Parameter[] {
  return operation.parameters?.filter((p) => p.in === "query") || [];
}

export function getBodyParameters(
  schema: any,
  operation: Operation
): Parameter[] {
  const requestSchema =
    operation.requestBody?.content["application/json"]?.schema;
  if (requestSchema) return bakeProperties(schema, requestSchema);
  return (
    operation.parameters?.filter((p) => p.in !== "path" && p.in !== "query") ||
    []
  );
}

export type ResponseSchemata = ResponseSchema[];
export type ResponseSchema = [
  string /* statusCode */,
  {
    response: Response;
    schema?: TypeDef | undefined;
  }
];
export function getResponseSchemata(
  schema: any,
  operation: Operation
): ResponseSchemata {
  const result: ResponseSchemata = [];
  for (const [statusCode, response] of Object.entries(operation.responses)) {
    const responseSchema =
      response.content?.["application/json"]?.schema || response.schema;
    const pair = { response, schema: responseSchema };
    result.push(narrowResponseSchema(schema, [statusCode, pair]));
  }
  return result;
}

function narrowResponseSchema(
  schema: any,
  responseSchema: ResponseSchema
): ResponseSchema {
  const [statusCode, pair] = responseSchema;
  if (!pair.schema) return responseSchema;
  const responseTypeDef = followRef(schema, pair.schema);
  if (!("discriminator" in responseTypeDef)) return responseSchema;
  const refs = Object.values(responseTypeDef.discriminator.mapping);
  const matches = refs
    .map((ref) => {
      const typeDef = getTypeDefByRef(schema, ref);
      const match = String(typeDef["x-portone-status-code"]) === statusCode;
      return { ref, typeDef, match };
    })
    .filter(({ match }) => match);
  const filteredRefs = matches.map(({ ref }) => ref);
  if (matches.length === 1) {
    const schema = matches[0]?.typeDef;
    return [statusCode, { ...pair, schema }];
  } else if (matches.length > 1) {
    const oneOf = responseTypeDef.oneOf?.filter(({ $ref }) =>
      filteredRefs.includes($ref!)
    );
    const mapping = Object.fromEntries(
      Object.entries(responseTypeDef.discriminator.mapping).filter(([, ref]) =>
        filteredRefs.includes(ref)
      )
    );
    const discriminator = { ...responseTypeDef.discriminator, mapping };
    const schema: TypeDef = { ...responseTypeDef, oneOf, discriminator };
    return [statusCode, { ...pair, schema }];
  } else {
    return responseSchema;
  }
}
