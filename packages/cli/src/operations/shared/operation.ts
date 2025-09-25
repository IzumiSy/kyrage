import { Kysely } from "kysely";
import { z } from "zod";

type DefineOperationProps<
  T extends string = string,
  S extends z.ZodType = z.ZodType,
> = {
  typeName: T;
  schema: S;
  execute: OperationExecutor<T, S>;
};

type OperationExecutor<
  T extends string = string,
  S extends z.ZodType = z.ZodType,
> = (
  db: Kysely<any>,
  operation: InferOpSchema<DefineOperationProps<T, S>>
) => Promise<void>;

export const defineOperation = <const T extends string, S extends z.ZodType>(
  props: DefineOperationProps<T, S>
) => props;

export type InferOpSchema<T extends DefineOperationProps> = z.infer<
  T["schema"]
>;
