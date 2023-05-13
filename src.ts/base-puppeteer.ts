import qs from "querystring";
import fs = require("fs-extra");
import totp from "totp-generator";
import child_process from "child_process";
import mkdirp from "mkdirp";
import path from "path";
import UserAgents from "user-agents";
import totpGenerator from "totp-generator";
import urlModule from "url";
import { Proxy6Client } from "proxy6";
import { generate } from "generate-password";
import { faker } from "@faker-js/faker";
import { proxyToExport } from "proxy6/lib/cli";
import net from "net";
const { executablePath } = require("puppeteer");
const puppeteer = require("puppeteer-extra");
const exec = (s) =>
  (child_process as any)
    .spawnSync(s.split(/\s+/)[0], s.split(/\s+/).slice(1))
    .stdout.toString("utf8");

const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const stealthPlugin = StealthPlugin();
stealthPlugin.enabledEvasions.delete("iframe.contentWindow");
stealthPlugin.enabledEvasions.delete("navigator.plugins");
puppeteer.use(stealthPlugin);

const timeout = async (n) =>
  await new Promise((resolve) => setTimeout(resolve, n));

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
  const split = v.split(':');
  if (split.length !== 4) return null;
  const [ service, cycleOrBuy, ipv4OrIpv6, country ] = split;
  return { service, cycleOrBuy, ipv4OrIpv6, country };
};

let proxy6: Proxy6Client;

const pickRandom = (list: any) => list[Math.floor(Math.random()*list.length)];

export class BasePuppeteer {
  public _page: any;
  public _content: string;
  public _browser: ReturnType<typeof puppeteer.launch> | null;
  public logger: any;
  public _flow: any[] | null;
  static PUPPETEER_CLASS = Symbol.for("@@puppeteer-class");
  static async initialize({
    headless,
    noSandbox,
    logger,
    session,
    proxyServer
  }: any = {}) {
    if (process.env.PROXY6_API_KEY) proxy6 = Proxy6Client.fromEnv();
    const proxyParams = paramsFromProxy6(proxyServer || '');
    if (proxyParams) {
      if (!proxy6) throw Error('PROXY6_API_KEY not set');
      const result = proxyParams.cycleOrBuy === 'random' ? pickRandom(Object.values(((await proxy6.getproxy({} as any)) as any).list).filter((v: any) => v.type === 'http' && (v.country === proxyParams.country && (proxyParams.ipv4OrIpv6 === 'ipv4' || v.version === '6')))) : Object.values(((await proxy6.buy({
        country: proxyParams.country,
	version: String(proxyParams.ipv4OrIpv6 === 'ipv6' ? 6 : 3),
	period: proxyParams.ipv4OrIpv6 === 'ipv6' ? 3 : 30,
	type: 'http',
	count: 1
      })) as any).list)[0];
      proxyServer = proxyToExport(result).replace(/export\s(.*?)_proxy=/, '');
    }
    if (!proxyServer) proxyServer = process.env.PUPPETEER_PROXY;
    const parsedProxyServer: any = proxyServer && urlModule.parse(proxyServer) || {};
    const { hostname, port, auth, protocol } = parsedProxyServer;
    const args = proxyServer
      ? ["--proxy-server=" + protocol + '//' + (net.isIPv6(hostname) ? `[${hostname}]` : hostname) + ':' + port ]
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
      } catch (e) {
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
    return instance;
  }
  async saveToBitwarden({ totp, name, uris, username, password }: any) {
    const entry: any = {
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
    child_process.spawnSync(
      "bash",
      [
        "-c",
        "echo '" + JSON.stringify(entry) + "' | bw encode | bw create item",
      ],
      { stdio: "inherit" }
    );
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
        } catch (e) {
          return args;
        }
      })();
    this._flow.push(["evaluate", { script, args }]);
    return await this._page.evaluate(
      async (_script, args) =>
        await eval("(" + _script + ")(..." + JSON.stringify(args) + ")"),
      script,
      args
    );
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
    if (this._flow) this._flow.push(["timeout", { n }]);
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
  async runFlow(flow: any[]) {
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
