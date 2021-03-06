/* tslint:disable: no-any */

import { taskEither } from "fp-ts/lib/TaskEither";
import { IResponseSuccessJson } from "italia-ts-commons/lib/responses";
import {
  EmailString,
  FiscalCode,
  NonEmptyString
} from "italia-ts-commons/lib/strings";
import { Repository } from "typeorm";
import { context } from "../../__mocks__/durable-functions";
import { BPDTransactionList } from "../../generated/definitions/BPDTransactionList";
import { Transaction } from "../../models/transaction";
import { RequestCitizenToAdUserAndFiscalCode } from "../../utils/middleware/citizen_id";
import { AdUser } from "../../utils/strategy/bearer_strategy";
import { GetBPDTransactionsHandler } from "../handler";

const mockFind = jest.fn();
const mockTransactionRepository = taskEither.of<Error, Repository<Transaction>>(
  ({
    find: mockFind
  } as unknown) as Repository<Transaction>
);

const aFiscalCode = "AAABBB01C02D345D" as FiscalCode;
const anAcquirer = "32875";
const aCircuitType = "01";
const aOperationType = "00";
const aTimestamp = new Date();

const anAuthenticatedUser: AdUser = {
  emails: ["email@example.com" as EmailString],
  family_name: "Surname",
  given_name: "Name",
  oid: "anUserOID" as NonEmptyString
};

const aUserAndFiscalCode: RequestCitizenToAdUserAndFiscalCode = {
  citizenIdType: "FiscalCode",
  fiscalCode: aFiscalCode,
  user: anAuthenticatedUser
};

describe("GetBPDTransactionsHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it("should return a success response if query success", async () => {
    mockFind.mockImplementationOnce(async () => {
      return [
        {
          acquirer: anAcquirer,
          circuit_type: aCircuitType,
          fiscal_code: aFiscalCode,
          hpan:
            "55ad015a3bf4f1b2b0b822cd15d6c15b0f00a089f86d081884c7d659a2feaa0c",
          id_trx_acquirer: "123456789012",
          operation_type: aOperationType,
          trx_timestamp: aTimestamp
        },
        {
          acquirer: anAcquirer,
          circuit_type: aCircuitType,
          fiscal_code: aFiscalCode,
          hpan:
            "0b822cd15d6c15b0f00a089f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b",
          id_trx_acquirer: "123456789013",
          operation_type: aOperationType,
          trx_timestamp: aTimestamp
        }
        // tslint:disable-next-line: readonly-array
      ] as Transaction[];
    });
    const handler = GetBPDTransactionsHandler(mockTransactionRepository);
    const response = await handler(context, aUserAndFiscalCode);

    expect(response.kind).toBe("IResponseSuccessJson");
    const responseValue = (response as IResponseSuccessJson<BPDTransactionList>)
      .value;
    expect(responseValue).toEqual({
      transactions: expect.any(Array)
    } as BPDTransactionList);
    expect(responseValue.transactions).toHaveLength(2);
  });

  it("should return a success reponse with empty transactions for user with no one transaction", async () => {
    mockFind.mockImplementationOnce(async () => {
      return [];
    });
    const handler = GetBPDTransactionsHandler(mockTransactionRepository);
    const response = await handler(context, aUserAndFiscalCode);

    expect(response.kind).toBe("IResponseSuccessJson");
    const responseValue = (response as IResponseSuccessJson<BPDTransactionList>)
      .value;
    expect(responseValue).toEqual({
      transactions: expect.any(Array)
    } as BPDTransactionList);
    expect(responseValue.transactions).toHaveLength(0);
  });

  it("should return an error the find query fail", async () => {
    const expectedError = new Error("Query Error");
    mockFind.mockImplementationOnce(() => {
      return Promise.reject(expectedError);
    });
    const handler = GetBPDTransactionsHandler(mockTransactionRepository);
    const response = await handler(context, aUserAndFiscalCode);

    expect(context.log.error).toBeCalledTimes(1);
    expect(response.kind).toBe("IResponseErrorInternal");
  });

  it("should return a validation error if the response decode fail", async () => {
    mockFind.mockImplementationOnce(async () => {
      return [
        {
          acquirer_descr: anAcquirer,
          fiscal_code: aFiscalCode,
          id_trx_acquirer: "123456789012",
          trx_timestamp: aTimestamp
        }
      ];
    });
    const handler = GetBPDTransactionsHandler(mockTransactionRepository);
    const response = await handler(context, aUserAndFiscalCode);

    expect(response.kind).toBe("IResponseErrorValidation");
  });
});
