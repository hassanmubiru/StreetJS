import { init } from '@streetjs/plugin-telegram';

const config: TelegramConfig = {
  token: 'YOUR_BOT_TOKEN',
  chatId: 123456,
  baseUrl: 'https://api.telegram.org',
};

const plugin = init(config);