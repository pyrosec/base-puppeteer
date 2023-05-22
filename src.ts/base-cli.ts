import { BasePuppeteer } from "./base-puppeteer";
import mkdirp from "mkdirp";
import yargs from "yargs";
import express from "express";
import bodyParser from "body-parser";
import morgan from "morgan";
import path from "path";
import { camelCase } from "change-case";
import fs from "fs-extra";
import "setimmediate";
import { faker } from "@faker-js/faker";
import child_process from "child_process";
import axios from "axios";

const findPuppeteerClass = (m) => {
  return m[Object.getOwnPropertyNames(m).find((v) => {
    return m[v].PUPPETEER_CLASS;
  })];
};

export class PuppeteerCLI {
  public programName: string;
  public logger: any;
  public PuppeteerClass: any;
  public puppeteerClassPath: string;
  constructor({ puppeteerClassPath, logger, programName }) {
    this.logger = logger;
    this.programName = programName;
    this.puppeteerClassPath = puppeteerClassPath;
    this.PuppeteerClass = findPuppeteerClass(require(puppeteerClassPath));
  }
  async saveSession(
    base,
    json = false,
    filename = ""
  ) {
    if (!base._browser) return base;
    if (!filename) filename = (await this.getSessionName()) + ".json";
    await mkdirp(path.join(process.env.HOME, '.' + this.programName));
    await fs.writeFile(
      path.join(process.env.HOME, '.' + this.programName, filename),
      await base.serialize()
    );
    if (!json) this.logger.info("saved to ~/" + path.join('.' + this.programName, filename));
    return base;
  }

  async setSessionName(name: string) {
    await mkdirp(path.join(process.env.HOME, '.' + this.programName));
    await fs.writeFile(
      path.join(process.env.HOME, '.' + this.programName, "session"),
      name
    );
  }

  async loadSession(
    { headless, sandbox, proxyServer, ...opts }: any = {},
    noPuppeteer = false
  ) {
    const session = JSON.parse(
      await fs.readFile(
        path.join(
          process.env.HOME,
          '.' + this.programName,
          (await this.getSessionName()) + ".json"
        ),
        "utf8"
      )
    );
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
          sandbox: ![false, undefined, null, "false"].includes(sandbox)
        } as any);
  }

  async initSession(
    name: string,
    { proxyServer, session, sandbox, ...opts }: any
  ) {
    await this.setSessionName(name);
    await fs.writeFile(
      path.join(process.env.HOME, '.' + this.programName, name + ".json"),
      JSON.stringify(
        {
          cookies: [],
        },
        null,
        2
      )
    );
    this.logger.info("created session ~/." + this.programName + "/" + name + ".json");
  }

  async hotReload() {
    this.logger.info("hot reload");
    delete require.cache[require.resolve(this.puppeteerClassPath)];
    const PuppeteerClassUpdated = findPuppeteerClass(require(this.puppeteerClassPath));
    Object.getOwnPropertyNames(PuppeteerClassUpdated.prototype).forEach(
      (prop) => {
        this.PuppeteerClass.prototype[prop] = PuppeteerClassUpdated.prototype[prop];
      }
    );
    this.logger.info("done!");
    return { success: true };
  }
  async getSessionName() {
    await mkdirp(path.join(process.env.HOME, '.' + this.programName));
    try {
      return (
        await fs.readFile(
          path.join(process.env.HOME, '.' + this.programName, "session"),
          "utf8"
        )
      ).trim();
    } catch (e) {
      await this.setSessionName("session");
      return "session";
    }
  }

  async callAPI(command, dataFull) {
    let { json, j, remoteAddr, remotePort, ...data } = dataFull;
    if (j) json = j;
    let result;
    if (remotePort) {
      if (!remoteAddr) remoteAddr = "127.0.0.1";
      const response = await axios.post(
        "http://" + remoteAddr + ":" + remotePort + "/execute",
        {
          method: camelCase(command),
          params: [data],
          jsonrpc: "2.0",
          id: Date.now(),
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          responseType: "json",
        }
      );
      if (response.data.error) throw response.data.error;
      result = response.data.result;
    } else {
      const base = await this.loadSession(
        data,
        ["save-to-bitwarden", "to-muttrc"].includes(command)
      );
      const camelCommand = camelCase(command);
      if (!base[camelCommand]) throw Error("command not foud: " + command);
      result = await base[camelCommand](data);
      await this.saveSession(base);
    }
    if (json) console.log(JSON.stringify(result, null, 2));
    else this.logger.info(result);
    process.exit(0);
    return result;
  }

  async loadFiles(data: any) {
    const fields = [];
    for (let [k, v] of Object.entries(data)) {
      const parts = /(^.*)FromFile$/.exec(k);
      if (parts) {
        const key = parts[1];
        fields.push([key, await fs.readFile(v)]);
      } else {
        fields.push([k, v]);
      }
    }
    return fields.reduce((r, [k, v]) => {
      r[k] = v;
      return r;
    }, {});
  }

  async startServer({
    listenAddr,
    listenPort,
    ...data
  }) {
    const base = await this.loadSession(data);
    return await new Promise((resolve, reject) => {
      const app = express();
      app.use(bodyParser.json());
      app.use(morgan("common"));
      app.post("/execute", (req, res) => {
        const body = req.body;
        (async () => {
          try {
            const result =
              body.method === "hotReload"
                ? await this.hotReload()
                : await base[body.method](...body.params);
            res.json({
              jsonrpc: "2.0",
              id: body.id,
              result,
            });
          } catch (e) {
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
      app.listen(listenPort || 8080, () =>
        resolve(app)
      );
    });
  }

  async runCLI() {
    const options = Object.assign({}, yargs.argv);
    delete options._;
    const data = await this.loadFiles(
      Object.entries(options).reduce((r, [k, v]) => {
        r[camelCase(k)] = String(v);
        return r;
      }, {})
    );
    delete data['0'];
    switch (yargs.argv._[0]) {
      case "init":
        return await this.initSession(yargs.argv._[1], data);
      case "load":
        await fs.writeFile(
          path.join(process.env.HOME, '.' + this.programName, "session"),
          yargs.argv._[1]
        );
        this.logger.info("using session " + yargs.argv._[1]);
        break;
      case "start-server":
        return await this.startServer(data);
      default:
        return await this.callAPI(yargs.argv._[0], data);
    }
  }
}
