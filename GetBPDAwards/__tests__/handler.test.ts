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
import { AwardsList } from "../../generated/definitions/AwardsList";
import { Award } from "../../models/award";
import { RequestCitizenToAdUserAndFiscalCode } from "../../utils/middleware/citizen_id";
import { AdUser } from "../../utils/strategy/bearer_strategy";
import { GetBPDAwardsHandler } from "../handler";

const mockFind = jest.fn();
const mockAwardRepository = taskEither.of<Error, Repository<Award>>(({
  find: mockFind
} as unknown) as Repository<Award>);

const aFiscalCode = "AAABBB01C02D345D" as FiscalCode;
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

describe("GetBPDAwardsHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it("should return a success response if query success", async () => {
    mockFind.mockImplementationOnce(async () => {
      return [
        {
          fiscal_code: aFiscalCode,
          award_winner_amount: 120,
          award_period_amount_max: 1,
          award_period_grace_period: 10,
          award_period_end: aTimestamp,
          award_period_start: aTimestamp,
          award_winner_id: 1,
          award_period_id: 1,
          award_period_cashback_perc: 10,
          award_period_cashback_max: 150,
          award_period_ranking_min: 0,
          award_period_trx_cashback_max: 1500,
          award_period_trx_eval_max: 1500,
          award_period_trx_volume_min: 1
        },
        {
          fiscal_code: aFiscalCode,
          award_winner_amount: 50,
          award_period_amount_max: 1,
          award_period_grace_period: 10,
          award_period_end: aTimestamp,
          award_period_start: aTimestamp,
          award_winner_id: 1,
          award_period_id: 1,
          award_period_cashback_perc: 10,
          award_period_cashback_max: 150,
          award_period_ranking_min: 0,
          award_period_trx_cashback_max: 1500,
          award_period_trx_eval_max: 1500,
          award_period_trx_volume_min: 1
        }
        // tslint:disable-next-line: readonly-array
      ] as Award[];
    });
    const handler = GetBPDAwardsHandler(mockAwardRepository);
    const response = await handler(context, aUserAndFiscalCode);

    expect(response.kind).toBe("IResponseSuccessJson");
    const responseValue = (response as IResponseSuccessJson<AwardsList>).value;
    expect(responseValue).toEqual({
      awards: expect.any(Array),
      fiscal_code: aFiscalCode
    } as AwardsList);
    expect(responseValue.awards).toHaveLength(2);
  });

  it("should return a success reponse with empty awards for user with no one award period", async () => {
    mockFind.mockImplementationOnce(async () => {
      return [
        {
          fiscal_code: aFiscalCode
        }
      ];
    });
    const handler = GetBPDAwardsHandler(mockAwardRepository);
    const response = await handler(context, aUserAndFiscalCode);

    expect(response.kind).toBe("IResponseSuccessJson");
    const responseValue = (response as IResponseSuccessJson<AwardsList>).value;
    expect(responseValue).toEqual({
      awards: [],
      fiscal_code: aFiscalCode
    } as AwardsList);
  });

  it("should return a not found respose if the user is missing in db", async () => {
    mockFind.mockImplementationOnce(async () => {
      return [];
    });
    const handler = GetBPDAwardsHandler(mockAwardRepository);
    const response = await handler(context, aUserAndFiscalCode);

    expect(response.kind).toBe("IResponseErrorNotFound");
  });

  it("should return an error the find query fail", async () => {
    const expectedError = new Error("Query Error");
    mockFind.mockImplementationOnce(() => {
      return Promise.reject(expectedError);
    });
    const handler = GetBPDAwardsHandler(mockAwardRepository);
    const response = await handler(context, aUserAndFiscalCode);

    expect(context.log.error).toBeCalledTimes(1);
    expect(response.kind).toBe("IResponseErrorInternal");
  });

  it("should return a validation error if the response decode fail", async () => {
    mockFind.mockImplementationOnce(async () => {
      return [
        {
          award_period_end: aTimestamp,
          award_period_start: aTimestamp,
          award_period_id: 1,
          fiscal_code: aFiscalCode
        }
      ];
    });
    const handler = GetBPDAwardsHandler(mockAwardRepository);
    const response = await handler(context, aUserAndFiscalCode);

    expect(response.kind).toBe("IResponseErrorValidation");
  });
});
