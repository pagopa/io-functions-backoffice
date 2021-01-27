import * as express from "express";
import * as passport from "passport";
import * as winston from "winston";

import { Context } from "@azure/functions";
import { TableService } from "azure-storage";
import { secureExpressApp } from "io-functions-commons/dist/src/utils/express";
import { AzureContextTransport } from "io-functions-commons/dist/src/utils/logging";
import { setAppContext } from "io-functions-commons/dist/src/utils/middlewares/context_middleware";
import createAzureFunctionHandler from "io-functions-express/dist/src/createAzureFunctionsHandler";

import { BlacklistSupportToken } from "./handler";

import { IServicePrincipalCreds } from "../utils/adb2c";
import { GetInsertOrReplaceEntity } from "../utils/audit_logs";
import { getConfigOrThrow } from "../utils/config";
import { GetOAuthVerifier } from "../utils/middleware/oauth_adb2c";
import { REDIS_CLIENT } from "../utils/redis";
import { setupBearerStrategy } from "../utils/strategy/bearer_strategy";

const config = getConfigOrThrow();

const tableService = new TableService(
  config.DASHBOARD_STORAGE_CONNECTION_STRING
);

// tslint:disable-next-line: no-let
let logger: Context["log"] | undefined;
const contextTransport = new AzureContextTransport(() => logger, {
  level: "debug"
});
winston.add(contextTransport);

// Setup Express
const app = express();
secureExpressApp(app);

const passportAuthenticator = new passport.Passport();

/**
 * Setup an authentication strategy (oauth) for express endpoints.
 */
setupBearerStrategy(
  passportAuthenticator,
  config.ADB2C_CONFIG,
  async (userId, profile) => {
    // executed when the user is logged in
    // userId === profile.oid
    // req.user === profile
    logger?.info("setupBearerStrategy %s %s", userId, JSON.stringify(profile));
  }
);

const adb2cCreds: IServicePrincipalCreds = {
  clientId: config.ADB2C_CLIENT_ID,
  secret: config.ADB2C_CLIENT_KEY,
  tenantId: config.ADB2C_TENANT_ID
};

// Add express route
app.delete(
  "/api/v1/bpd/support-token",
  GetOAuthVerifier(passportAuthenticator, config.ADB2C_POLICY_NAME),
  BlacklistSupportToken(
    GetInsertOrReplaceEntity(tableService, config.DASHBOARD_LOGS_TABLE_NAME),
    config.JWT_SUPPORT_TOKEN_PUBLIC_RSA_CERTIFICATE,
    adb2cCreds,
    config.ADB2C_ADMIN_GROUP_NAME,
    config.IN_MEMORY_CACHE_TTL,
    REDIS_CLIENT
  )
);

const azureFunctionHandler = createAzureFunctionHandler(app);

// Binds the express app to an Azure Function handler
function httpStart(context: Context): void {
  logger = context.log;
  setAppContext(app, context);
  azureFunctionHandler(context);
}

export default httpStart;