declare const puppeteer: any;
export declare class BasePuppeteer {
    _page: any;
    _content: string;
    _browser: ReturnType<typeof puppeteer.launch> | null;
    logger: any;
    _flow: any[] | null;
    static PUPPETEER_CLASS: symbol;
    static initialize({ headless, noSandbox, logger, session, proxyServer }?: any): Promise<BasePuppeteer>;
    saveToBitwarden({ totp, name, uris, username, password }: any): Promise<{
        success: boolean;
    }>;
    constructor({ logger, session, browser, ...props }: {
        [x: string]: any;
        logger: any;
        session: any;
        browser: any;
    });
    toObject(): Promise<this & {
        content: string;
        cookies: any;
    }>;
    beginFlow(): {
        success: boolean;
        message: string;
    };
    serialize(): Promise<string>;
    evaluate({ script, args }: {
        script: any;
        args: any;
    }): Promise<any>;
    waitForSelector({ selector }: {
        selector: any;
    }): Promise<{
        success: boolean;
    }>;
    click({ selector, ...options }: {
        [x: string]: any;
        selector: any;
    }): Promise<{
        sucess: boolean;
    }>;
    timeout({ n }: {
        n: any;
    }): Promise<{
        success: boolean;
    }>;
    select({ selector, value }: {
        selector: any;
        value: any;
    }): Promise<{
        success: boolean;
    }>;
    type({ selector, value }: {
        selector: any;
        value: any;
    }): Promise<{
        success: boolean;
    }>;
    runFlow(flow: any[]): Promise<any>;
    content(): Promise<any>;
    dumpInputs(): Promise<any>;
    dumpFlow(): string;
    goto({ url, ...options }: {
        [x: string]: any;
        url: any;
    }): Promise<{
        success: boolean;
    }>;
}
export {};
