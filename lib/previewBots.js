// Link-preview crawlers (Telegram, WhatsApp, Viber…). The tournament and
// player pages build their rich <head> only for them — for everyone else
// it would just add a database round trip to every navigation.
export const PREVIEW_BOT_RE = /TelegramBot|facebookexternalhit|WhatsApp|Viber|Twitterbot|Slackbot|Discordbot|LinkedInBot|SkypeUriPreview/i;
