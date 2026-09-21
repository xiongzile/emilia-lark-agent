function requiredEnvironmentVariable(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(
            `Missing ${name}. Copy .env.example to .env and provide the value.`,
        );
    }
    return value;
}

export const feishuConfig = {
    appId: requiredEnvironmentVariable("FEISHU_APP_ID"),
    appSecret: requiredEnvironmentVariable("FEISHU_APP_SECRET"),
};
