"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BasePuppeteer = void 0;
const child_process_1 = __importDefault(require("child_process"));
const url_1 = __importDefault(require("url"));
const proxy6_1 = require("proxy6");
const cli_1 = require("proxy6/lib/cli");
const net_1 = __importDefault(require("net"));
const { executablePath } = require("puppeteer");
const puppeteer = require("puppeteer-extra");
const exec = (s) => child_process_1.default
    .spawnSync(s.split(/\s+/)[0], s.split(/\s+/).slice(1))
    .stdout.toString("utf8");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const stealthPlugin = StealthPlugin();
stealthPlugin.enabledEvasions.delete("iframe.contentWindow");
stealthPlugin.enabledEvasions.delete("navigator.plugins");
puppeteer.use(stealthPlugin);
const timeout = async (n) => await new Promise((resolve) => setTimeout(resolve, n));
const getOuterHTMLAll = async (page, selectors) => {
    return await page.evaluate((selectors) => {
        return selectors.reduce((r, v) => {
            const els = [].slice
                .call(document.querySelectorAll(v))
                .map((v) => v.outerHTML);
            r[v] = els;
            return r;
        }, {});
    }, selectors);
};
const paramsFromProxy6 = (v) => {
    const split = v.split(":");
    if (split[0] === 'proxy6')
        return null;
    if (split.length !== 4)
        return null;
    const [service, cycleOrBuy, ipv4OrIpv6, country] = split;
    return { service, cycleOrBuy, ipv4OrIpv6, country };
};
let proxy6;
const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
class BasePuppeteer {
    static async initialize(o = {}) {
        let { headless, noSandbox, logger, session, retryProxy, waitProxy, proxyServer, } = o;
        if (process.env.PROXY6_API_KEY)
            proxy6 = proxy6_1.Proxy6Client.fromEnv();
        const proxyParams = paramsFromProxy6(proxyServer || "");
        if (proxyParams) {
            if (!proxy6)
                throw Error("PROXY6_API_KEY not set");
            const result = proxyParams.cycleOrBuy === "random"
                ? pickRandom(Object.values((await proxy6.getproxy({})).list).filter((v) => v.type === "http" &&
                    v.country === proxyParams.country &&
                    (proxyParams.ipv4OrIpv6 === "ipv4" || v.version === "6")))
                : Object.values((await proxy6.buy({
                    country: proxyParams.country,
                    version: String(proxyParams.ipv4OrIpv6 === "ipv6" ? 6 : 3),
                    period: proxyParams.ipv4OrIpv6 === "ipv6" ? 3 : 30,
                    type: "http",
                    count: 1,
                })).list)[0];
            proxyServer = (0, cli_1.proxyToExport)(result).replace(/export\s(.*?)_proxy=/, "");
            if (waitProxy) {
                if (isNaN(waitProxy))
                    throw Error("--wait-proxy must be an integer");
                await timeout(Number(waitProxy));
            }
        }
        if (!proxyServer)
            proxyServer = process.env.PUPPETEER_PROXY;
        const parsedProxyServer = (proxyServer && url_1.default.parse(proxyServer)) || {};
        const { hostname, port, auth, protocol } = parsedProxyServer;
        const args = proxyServer
            ? [
                "--proxy-server=" +
                    protocol +
                    "//" +
                    (net_1.default.isIPv6(hostname) ? `[${hostname}]` : hostname) +
                    ":" +
                    port,
            ]
            : [];
        args.push("--disable-web-security");
        if (noSandbox) {
            args.push("--no-sandbox");
            args.push("--disable-setuid-sandbox");
        }
        const instance = new this({
            browser: await puppeteer.launch({
                executablePath: executablePath(),
                ignoreHTTPSErrors: Boolean(proxyServer),
                headless: !(headless === false) && "new",
                args,
            }),
            logger,
            session,
        });
        instance._page = await instance._browser.newPage();
        await instance._page.setBypassCSP(true);
        if (session) {
            try {
                await instance._page.setCookie(...(session.cookies || []));
            }
            catch (e) {
                console.error(e);
            }
            await instance._page.setContent(session.content || "");
        }
        if (auth) {
            const [username, password] = auth.split(":");
            await instance._page.authenticate({
                username,
                password,
            });
        }
        if (proxyServer && retryProxy) {
            try {
                const { ip } = await instance._page.evaluate(async () => {
                    const response = await (await window.fetch("https://api64.ipify.org?format=json", {
                        method: "GET",
                    })).json();
                    return response;
                });
                instance.logger.info("ip|" + ip);
            }
            catch (e) {
                instance.logger.error(e);
                return await this.initialize(o);
            }
        }
        return instance;
    }
    async saveToBitwarden({ totp, name, uris, username, password }) {
        const entry = {
            organizationId: null,
            collectionIds: null,
            folderId: null,
            type: 1,
            name,
            notes: "",
            favorite: false,
            fields: [],
            secureNote: null,
            card: null,
            identity: null,
            reprompt: 0,
            login: {
                uris: uris.map((v) => ({
                    match: null,
                    uri: v,
                })),
                username: username,
                totp,
                password: password,
            },
        };
        child_process_1.default.spawnSync("bash", [
            "-c",
            "echo '" + JSON.stringify(entry) + "' | bw encode | bw create item",
        ], { stdio: "inherit" });
        return { success: true };
    }
    constructor({ logger, session, browser, ...props }) {
        this._browser = browser;
        this.logger = logger;
        this._flow = [];
        Object.assign(this, session, props);
    }
    async toObject() {
        const content = "";
        const { cookies } = await this._page
            ._client()
            .send("Network.getAllCookies");
        const serialized = Object.assign({}, this, {
            content,
            cookies,
        });
        delete serialized._page;
        delete serialized.logger;
        delete serialized._browser;
        return serialized;
    }
    beginFlow() {
        this.logger.info("recording flow");
        this._flow = [];
        return { success: true, message: "recording flow" };
    }
    async serialize() {
        return JSON.stringify(await this.toObject(), null, 2);
    }
    async evaluate({ script, args }) {
        if (typeof args === "string")
            args = (() => {
                try {
                    return JSON.parse(args);
                }
                catch (e) {
                    return args;
                }
            })();
        this._flow.push(["evaluate", { script, args }]);
        return await this._page.evaluate(async (_script, args) => await eval("(" + _script + ")(..." + JSON.stringify(args) + ")"), script, args);
    }
    async waitForSelector({ selector }) {
        this._flow.push(["waitForSelector", { selector }]);
        await this._page.waitForSelector(selector);
        return { success: true };
    }
    async click({ selector, ...options }) {
        this._flow.push(["click", { selector, ...options }]);
        await this._page.click(selector, options);
        return { sucess: true };
    }
    async timeout({ n }) {
        if (this._flow)
            this._flow.push(["timeout", { n }]);
        await timeout(n);
        return { success: true };
    }
    async select({ selector, value }) {
        this._flow.push(["select", { selector, value }]);
        await this._page.select(selector, value);
        return { success: true };
    }
    async type({ selector, value }) {
        this._flow.push(["type", { selector, value }]);
        await this._page.type(selector, value);
        return { success: true };
    }
    async runFlow(flow) {
        let lastResult = null;
        for (const [method, data] of flow) {
            lastResult = await this[method](data);
        }
        return lastResult;
    }
    async content() {
        return await this._page.content();
    }
    async dumpInputs() {
        return await getOuterHTMLAll(this._page, [
            "input",
            "a",
            "button",
            "textarea",
        ]);
    }
    dumpFlow() {
        return JSON.stringify(this._flow);
    }
    async goto({ url, ...options }) {
        this._flow.push(["goto", { url, ...options }]);
        await this._page.goto(url);
        return { success: true };
    }
}
exports.BasePuppeteer = BasePuppeteer;
BasePuppeteer.PUPPETEER_CLASS = Symbol.for("@@puppeteer-class");
//# sourceMappingURL=base-puppeteer.js.map