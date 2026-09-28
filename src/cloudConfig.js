// 云服务 publicConfig —— 开源仓库里**不含任何真实值**，一律从环境变量注入。
// 复制 .env.example 为 .env.local 并填入自己的两个值（.env.local 已被 git 忽略）。
// 两个值的来源：在 WorkBuddy 里为本项目开通云服务后由平台下发。
// 注意：endpoint 不能从 location 推，全站只认这一处。
const endpoint = import.meta.env.VITE_WB_ENDPOINT || ''
const publishableKey = import.meta.env.VITE_WB_PUBLISHABLE_KEY || ''

export const CLOUD_CONFIG = { endpoint, publishableKey }

// 没配就当"没接云"，界面上给出提示，而不是让 SDK 拿着空值去报错
export const CLOUD_READY = !!(endpoint && publishableKey)
