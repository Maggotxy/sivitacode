/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-15.1'

/** SivitaCode's complete editable preview notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '欢迎使用 SivitaCode',
    body: 'SivitaCode 目前处于开源预览阶段，面向 Linux、macOS 与无桌面的远程服务器持续完善。核心工作流已经可以使用，插件接口和部分配置仍可能在后续版本中演进。\n\n项目基于 MIT 许可的 DeepSeek Harness 开发，并包含 SivitaCode 自有的 Web 部署、认证、远程执行与产品体验改进。欢迎反馈真实开发场景中的问题与建议。',
    continueLabel: '继续',
  },
  en: {
    title: 'Welcome to SivitaCode',
    body: 'SivitaCode is currently an open-source preview for Linux, macOS, and headless remote servers. Core workflows are ready to use; plugin interfaces and some configuration may continue to evolve.\n\nThe project is developed from the MIT-licensed DeepSeek Harness and adds SivitaCode-owned Web deployment, authentication, remote execution, and product-experience improvements. Feedback from real development workflows is welcome.',
    continueLabel: 'Continue',
  },
} as const
