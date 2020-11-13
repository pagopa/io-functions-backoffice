import * as express from "express";

import { Context } from "@azure/functions";
import { Either } from "fp-ts/lib/Either";
import { identity } from "fp-ts/lib/function";
import {
  fromEither,
  fromLeft,
  fromPredicate,
  TaskEither,
  tryCatch
} from "fp-ts/lib/TaskEither";
import { taskEither } from "fp-ts/lib/TaskEither";
import { ContextMiddleware } from "io-functions-commons/dist/src/utils/middlewares/context_middleware";
import {
  withRequestMiddlewares,
  wrapRequestHandler
} from "io-functions-commons/dist/src/utils/request_middleware";
import * as t from "io-ts";
import { readableReport } from "italia-ts-commons/lib/reporters";
import {
  IResponseErrorForbiddenNotAuthorized,
  IResponseErrorInternal,
  IResponseErrorNotFound,
  IResponseErrorValidation,
  IResponseSuccessJson,
  ResponseErrorInternal,
  ResponseErrorNotFound,
  ResponseErrorValidation,
  ResponseSuccessJson
} from "italia-ts-commons/lib/responses";
import { FiscalCode, NonEmptyString } from "italia-ts-commons/lib/strings";
import { Repository } from "typeorm";
import { BPDCitizen } from "../generated/definitions/BPDCitizen";
import { CitizenID } from "../generated/definitions/CitizenID";
import { PaymentMethod } from "../generated/definitions/PaymentMethod";
import { SupportToken } from "../generated/definitions/SupportToken";
import { Citizen } from "../models/citizen";
import { RequiredHeaderMiddleware } from "../utils/middleware/required_header";
import { verifySupportToken } from "../utils/token";

type ResponseErrorTypes =
  | IResponseErrorForbiddenNotAuthorized
  | IResponseErrorNotFound
  | IResponseErrorInternal
  | IResponseErrorValidation;

type IHttpHandler = (
  context: Context,
  citizenId: CitizenID
) => Promise<
  // tslint:disable-next-line: max-union-size
  IResponseSuccessJson<BPDCitizen> | ResponseErrorTypes
>;

// Convert model object to API object
export const toApiBPDCitizen = (
  domainObj: ReadonlyArray<Citizen>
): Either<t.Errors, BPDCitizen> => {
  return BPDCitizen.decode(
    domainObj.reduce((acc: BPDCitizen | undefined, citizen) => {
      if (acc === undefined) {
        return {
          citizen_enabled: citizen.citizen_enabled,
          fiscal_code: citizen.fiscal_code,
          onboarding_date: citizen.onboarding_date?.toISOString(),
          onboarding_issuer_id: citizen.onboarding_issuer_id,
          payment_methods: PaymentMethod.is(citizen) ? [citizen] : [],
          timestamp_tc: citizen.timestamp_tc.toISOString(),
          update_date: citizen.update_date?.toISOString(),
          update_user: citizen.update_user,

          pay_off_instr: citizen.pay_off_instr
        };
      }
      if (PaymentMethod.is(citizen)) {
        return {
          ...acc,
          payment_methods: [...acc.payment_methods, citizen]
        };
      }
      return acc;
    }, undefined)
  );
};

const verifyCitizenId = (
  citizenId: CitizenID,
  publicRsaCertificate: NonEmptyString
) =>
  // TODO insert group check in case of a FiscalCode used by non admin users
  SupportToken.is(citizenId)
    ? verifySupportToken(publicRsaCertificate, citizenId)
    : taskEither.of<IResponseErrorForbiddenNotAuthorized, FiscalCode>(
        citizenId
      );

export function GetBPDCitizenHandler(
  citizenRepository: TaskEither<Error, Repository<Citizen>>,
  publicRsaCertificate: NonEmptyString
): IHttpHandler {
  return async (context, citizenId) => {
    return verifyCitizenId(citizenId, publicRsaCertificate)
      .foldTaskEither<
        // tslint:disable-next-line: max-union-size
        | IResponseErrorForbiddenNotAuthorized
        | IResponseErrorValidation
        | IResponseErrorInternal
        | IResponseErrorNotFound,
        readonly Citizen[]
      >(fromLeft, requestFiscalCode =>
        citizenRepository
          .chain(citizen =>
            tryCatch(
              () => citizen.find({ fiscal_code: requestFiscalCode }),
              err => {
                context.log.error(
                  `GetUserHandler|ERROR|Find citizen query error [${err}]`
                );
                return new Error("Citizen find query error");
              }
            )
          )
          .mapLeft(err => ResponseErrorInternal(err.message))
      )
      .chain(
        fromPredicate(
          citizenData => citizenData.length > 0,
          () => ResponseErrorNotFound("Not found", "Citizen not found")
        )
      )
      .chain(citizenData =>
        fromEither(toApiBPDCitizen(citizenData)).mapLeft(err =>
          ResponseErrorValidation(
            "Invalid BPDCitizen object",
            readableReport(err)
          )
        )
      )
      .fold<ResponseErrorTypes | IResponseSuccessJson<BPDCitizen>>(
        identity,
        ResponseSuccessJson
      )
      .run();
  };
}

export function GetBPDCitizen(
  citizenRepository: TaskEither<Error, Repository<Citizen>>,
  publicRsaCertificate: NonEmptyString
): express.RequestHandler {
  const handler = GetBPDCitizenHandler(citizenRepository, publicRsaCertificate);

  const middlewaresWrap = withRequestMiddlewares(
    ContextMiddleware(),
    RequiredHeaderMiddleware("x-citizen-id", CitizenID)
  );

  return wrapRequestHandler(middlewaresWrap(handler));
}