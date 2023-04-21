"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PuppeteerCLI = void 0;
const mkdirp_1 = __importDefault(require("mkdirp"));
const yargs_1 = __importDefault(require("yargs"));
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const change_case_1 = require("change-case");
const fs_extra_1 = __importDefault(require("fs-extra"));
require("setimmediate");
const axios_1 = __importDefault(require("axios"));
const findPuppeteerClass = (m) => {
    return m[Object.getOwnPropertyNames(m).find((v) => {
        return m[v].PUPPETEER_CLASS;
    })];
};
class PuppeteerCLI {
    constructor({ puppeteerClassPath, logger, programName }) {
        this.logger = logger;
        this.programName = programName;
        this.puppeteerClassPath = puppeteerClassPath;
        this.PuppeteerClass = findPuppeteerClass(require(puppeteerClassPath));
    }
    async saveSession(base, json = false, filename = "") {
        if (!base._browser)
            return base;
        if (!filename)
            filename = (await this.getSessionName()) + ".json";
        await (0, mkdirp_1.default)(path_1.default.join(process.env.HOME, '.' + this.programName));
        await fs_extra_1.default.writeFile(path_1.default.join(process.env.HOME, '.' + this.programName, filename), await base.serialize());
        if (!json)
            this.logger.info("saved to ~/" + path_1.default.join('.' + this.programName, filename));
        return base;
    }
    async setSessionName(name) {
        await (0, mkdirp_1.default)(path_1.default.join(process.env.HOME, '.' + this.programName));
        await fs_extra_1.default.writeFile(path_1.default.join(process.env.HOME, '.' + this.programName, "session"), name);
    }
    async loadSession({ headless, sandbox, proxyServer, ...opts } = {}, noPuppeteer = false) {
        const session = JSON.parse(await fs_extra_1.default.readFile(path_1.default.join(process.env.HOME, '.' + this.programName, (await this.getSessionName()) + ".json"), "utf8"));
        return noPuppeteer
            ? new this.PuppeteerClass({
                session,
                logger: this.logger,
                ...opts,
                browser: null,
            })
            : await this.PuppeteerClass.initialize({
                proxyServer,
                logger: this.logger,
                headless: headless !== "false",
                session,
                ...opts,
                noSandbox: sandbox === "false",
            });
    }
    async initSession(name, { proxyServer, session, sandbox, ...opts }) {
        await this.setSessionName(name);
        await fs_extra_1.default.writeFile(path_1.default.join(process.env.HOME, '.' + this.programName, name + ".json"), JSON.stringify({
            cookies: [],
        }, null, 2));
        this.logger.info("created session ~/." + this.programName + "/" + name + ".json");
    }
    async hotReload() {
        this.logger.info("hot reload");
        delete require.cache[require.resolve(this.puppeteerClassPath)];
        const PuppeteerClassUpdated = findPuppeteerClass(require(this.puppeteerClassPath));
        Object.getOwnPropertyNames(PuppeteerClassUpdated.prototype).forEach((prop) => {
            this.PuppeteerClass.prototype[prop] = PuppeteerClassUpdated.prototype[prop];
        });
        this.logger.info("done!");
        return { success: true };
    }
    async getSessionName() {
        await (0, mkdirp_1.default)(path_1.default.join(process.env.HOME, '.' + this.programName));
        try {
            return (await fs_extra_1.default.readFile(path_1.default.join(process.env.HOME, '.' + this.programName, "session"), "utf8")).trim();
        }
        catch (e) {
            await this.setSessionName("session");
            return "session";
        }
    }
    async callAPI(command, dataFull) {
        let { json, j, remoteAddr, remotePort, ...data } = dataFull;
        if (j)
            json = j;
        let result;
        if (remotePort) {
            if (!remoteAddr)
                remoteAddr = "127.0.0.1";
            const response = await axios_1.default.post("http://" + remoteAddr + ":" + remotePort + "/execute", {
                method: (0, change_case_1.camelCase)(command),
                params: [data],
                jsonrpc: "2.0",
                id: Date.now(),
            }, {
                headers: {
                    "Content-Type": "application/json",
                },
                responseType: "json",
            });
            if (response.data.error)
                throw response.data.error;
            result = response.data.result;
        }
        else {
            const base = await this.loadSession(data, ["save-to-bitwarden", "to-muttrc"].includes(command));
            const camelCommand = (0, change_case_1.camelCase)(command);
            if (!base[camelCommand])
                throw Error("command not foud: " + command);
            result = await base[camelCommand](data);
            await this.saveSession(base);
        }
        if (json)
            console.log(JSON.stringify(result, null, 2));
        else
            this.logger.info(result);
        process.exit(0);
        return result;
    }
    async loadFiles(data) {
        const fields = [];
        for (let [k, v] of Object.entries(data)) {
            const parts = /(^.*)FromFile$/.exec(k);
            if (parts) {
                const key = parts[1];
                fields.push([key, await fs_extra_1.default.readFile(v)]);
            }
            else {
                fields.push([k, v]);
            }
        }
        return fields.reduce((r, [k, v]) => {
            r[k] = v;
            return r;
        }, {});
    }
    async startServer({ listenAddr, listenPort, ...data }) {
        const base = await this.loadSession(data);
        return await new Promise((resolve, reject) => {
            const app = (0, express_1.default)();
            app.use(body_parser_1.default.json());
            app.use((0, morgan_1.default)("common"));
            app.post("/execute", (req, res) => {
                const body = req.body;
                (async () => {
                    try {
                        const result = body.method === "hotReload"
                            ? await this.hotReload()
                            : await base[body.method](...body.params);
                        res.json({
                            jsonrpc: "2.0",
                            id: body.id,
                            result,
                        });
                    }
                    catch (e) {
                        console.error(e);
                        res.json({
                            jsonrpc: "2.0",
                            id: body.id,
                            error: { stack: e.stack, message: e.message, name: e.name }
                        });
                    }
                    await this.saveSession(base);
                })();
            });
            app.listen(listenPort || 8080, (err) => err ? reject(err) : resolve(app));
        });
    }
    async runCLI() {
        const options = Object.assign({}, yargs_1.default.argv);
        delete options._;
        const data = await this.loadFiles(Object.entries(options).reduce((r, [k, v]) => {
            r[(0, change_case_1.camelCase)(k)] = String(v);
            return r;
        }, {}));
        delete data['0'];
        switch (yargs_1.default.argv._[0]) {
            case "init":
                return await this.initSession(yargs_1.default.argv._[1], data);
            case "load":
                await fs_extra_1.default.writeFile(path_1.default.join(process.env.HOME, '.' + this.programName, "session"), yargs_1.default.argv._[1]);
                this.logger.info("using session " + yargs_1.default.argv._[1]);
                break;
            case "start-server":
                return await this.startServer(data);
            default:
                return await this.callAPI(yargs_1.default.argv._[0], data);
        }
    }
}
exports.PuppeteerCLI = PuppeteerCLI;
//# sourceMappingURL=base-cli.js.map