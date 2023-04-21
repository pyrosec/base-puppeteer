import "setimmediate";
export declare class PuppeteerCLI {
    programName: string;
    logger: any;
    PuppeteerClass: any;
    puppeteerClassPath: string;
    constructor({ puppeteerClassPath, logger, programName }: {
        puppeteerClassPath: any;
        logger: any;
        programName: any;
    });
    saveSession(base: any, json?: boolean, filename?: string): Promise<any>;
    setSessionName(name: string): Promise<void>;
    loadSession({ headless, sandbox, proxyServer, ...opts }?: any, noPuppeteer?: boolean): Promise<any>;
    initSession(name: string, { proxyServer, session, sandbox, ...opts }: any): Promise<void>;
    hotReload(): Promise<{
        success: boolean;
    }>;
    getSessionName(): Promise<any>;
    callAPI(command: any, dataFull: any): Promise<any>;
    loadFiles(data: any): Promise<any>;
    startServer({ listenAddr, listenPort, ...data }: {
        [x: string]: any;
        listenAddr: any;
        listenPort: any;
    }): Promise<unknown>;
    runCLI(): Promise<any>;
}
