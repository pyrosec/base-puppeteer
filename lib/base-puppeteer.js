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
const crypto_1 = __importDefault(require("crypto"));
const lodash_1 = __importDefault(require("lodash"));
const proxies_fo_1 = require("proxies-fo");
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
const proxiesFo = new proxies_fo_1.ProxiesFoClient({});
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
const proxy6ParamsFromProxyServer = (v) => {
    const split = v.split(":");
    if (split[0] !== "proxy6")
        return null;
    if (split.length !== 4)
        return null;
    const [service, cycleOrBuy, ipv4OrIpv6, country] = split;
    return { service, cycleOrBuy, ipv4OrIpv6, country };
};
const proxiesFoParamsFromProxyServer = (v) => {
    const split = v.split(":");
    if (split[0] !== "proxies-fo")
        return null;
    if (split.length !== 2)
        return null;
    const [service, cycleOrBuy] = split;
    return { service, cycleOrBuy };
};
const proxiesFoItemToProxyString = (item) => {
    return url_1.default.format({
        protocol: "http:",
        hostname: item.serverIP,
        port: item.serverPort,
        auth: item.authUser + ":" + item.authPass,
    });
};
const getProxiesFoProxy = async (buy) => {
    const { payload: subUsers } = await proxiesFo.getAllSubUsers();
    let id = (subUsers.find((v) => v.email.match(/^[a-f0-9]+@guerrillamailblock.com/)) || {})._id || null;
    if (!id) {
        const username = crypto_1.default.randomBytes(6).toString("hex");
        const email = username + "@guerrillamailblock.com";
        await proxiesFo.createSubUser({ username, email });
        return await getProxiesFoProxy(buy);
    }
    if (buy) {
        const { payload: { plans }, } = await proxiesFo.getAllPlans();
        const { _id } = lodash_1.default.minBy(plans.filter((v) => v.provider === "Residential"), (v) => Number(v.price));
        const { payload: { subscription }, } = await proxiesFo.addPlanToSubUser({ accountId: id, planId: _id });
        const { payload: { activeSubscriptions }, } = await proxiesFo.getSingleSubUser({ accountId: id });
        const found = activeSubscriptions.find((v) => v._id === subscription._id);
        return proxiesFoItemToProxyString(found);
    }
    else {
        const { payload: { activeSubscriptions }, } = await proxiesFo.getSingleSubUser({ accountId: id });
        return proxiesFoItemToProxyString(activeSubscriptions[Math.floor(Math.random() * activeSubscriptions.length)]);
    }
};
let proxy6;
const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
class BasePuppeteer {
    static async initialize(o = {}) {
        let { headless, sandbox, logger, session, retryProxy, waitProxy, proxyServer, } = o;
        if (process.env.PROXY6_API_KEY)
            proxy6 = proxy6_1.Proxy6Client.fromEnv();
        const proxyParams = proxy6ParamsFromProxyServer(proxyServer || "");
        const proxiesFoParams = proxiesFoParamsFromProxyServer(proxyServer || "");
        if (proxyParams) {
            if (!proxy6)
                throw Error("PROXY6_API_KEY not set");
            const result = proxyParams.cycleOrBuy === "random"
                ? pickRandom(Object.values((await proxy6.getproxy({})).list).filter((v) => v.type === "http" &&
                    v.country === proxyParams.country &&
                    (proxyParams.ipv4OrIpv6 === "ipv4" && (v.version == 4 || v.version == 3)) || (v.version == 6 && proxyParams.ipv4OrIpv6 === "ipv6")))
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
        if (proxiesFoParams) {
            proxyServer = await getProxiesFoProxy(proxiesFoParams.cycleOrBuy === "buy");
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
        if (!sandbox) {
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
    async waitForSelectorFromList({ selectors } = { selectors: [] }) {
        return await this._page.evaluate(async (selectors) => {
            while (true) {
                const found = selectors.find((v) => document.querySelector(v));
                if (found)
                    return found;
                else
                    await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }, selectors);
    }
    async scrollIntoView({ selector }) {
        const page = this._page;
        await page.evaluate((selector) => document.querySelector(selector).scrollIntoView(), selector);
    }
    async stealthType({ selector, value }) {
        const page = this._page;
        const chars = [].slice.call(value);
        await this.scrollIntoView({ selector });
        await this.timeout({ n: 250 + Math.floor(Math.random() * 500) });
        for (const char of chars) {
            await page.type(selector, char);
            await this.timeout({ n: 100 + Math.floor(Math.random() * 200) });
        }
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
        await this.scrollIntoView({ selector });
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
        await this.scrollIntoView({ selector });
        await this._page.select(selector, value);
        return { success: true };
    }
    async type({ stealth, selector, value }) {
        this._flow.push(["type", { selector, value }]);
        if (stealth)
            await this.stealthType({ selector, value });
        else
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