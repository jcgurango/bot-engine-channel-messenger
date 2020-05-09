import { IChannel, BotEngine, IIncomingMessage, IncomingMessageType, IStep, OutgoingMessageType, IOutgoingMessage } from '@bot-engine/core';
import { Payload, QuickReplyPayload, MessagePayload, PostbackPayload } from 'facebook-messenger-api-types';
import { IBotOptions } from './interfaces';

// @ts-ignore
const Bot = require('messenger-bot');

export default class MessengerChannel implements IChannel {
    private bot: any;

    constructor(options: IBotOptions) {
        this.bot = new Bot(options);
    }

    middleware() {
        return this.bot.middleware();
    }

    onError(error: Function) {
        this.bot.on('error', error);
    }

    private parsePayload(payload: Payload): IIncomingMessage {
        const asQuickReply = payload as QuickReplyPayload;
        const asPostback = payload as PostbackPayload;
        const asMessage = payload as MessagePayload;

        if (asQuickReply.message && asQuickReply.message.quick_reply) {
            return {
                type: IncomingMessageType.POSTBACK,
                text: asQuickReply.message.text,
                payload: asQuickReply.message.quick_reply.payload,
                metadata: asQuickReply,
            };
        }

        if (asPostback.postback) {
            return {
                type: IncomingMessageType.POSTBACK,
                text: '',
                payload: asPostback.postback.payload,
                metadata: asPostback,
            };
        }

        return {
            type: IncomingMessageType.PLAINTEXT,
            text: asMessage.message.text.toString(),
            metadata: asMessage,
        };
    }

    private parseOutgoingMessage(message: IOutgoingMessage): any {
        if (message.type === OutgoingMessageType.PLAINTEXT) {
            return {
                text: message.payload,
            };
        }

        if (message.type === OutgoingMessageType.CUSTOM && message.payload.messenger) {
            return message.payload.messenger;
        }

        return {
            text: message.payload,
        };
    }

    private async respond(response: IStep, reply: any) {
        let lastMessage: any = {};

        // Create the response.
        if (response.messages.length > 0) {
            for (let i = 0; i < response.messages.length - 1; i++) {
                const message = response.messages[i];
                await reply(this.parseOutgoingMessage(message));
            }

            lastMessage = this.parseOutgoingMessage(response.messages[response.messages.length - 1]);
        } else {
            lastMessage = {
                text: 'Please select an option',
            };
        }

        response.responses.forEach((response) => {
            if (response.type === IncomingMessageType.POSTBACK && response.text) {
                if (!lastMessage.quick_replies) {
                    lastMessage.quick_replies = [];
                }

                lastMessage.quick_replies.push({
                    content_type: 'text',
                    title: response.text,
                    payload: response.payload,
                });
            }
        });

        await reply(lastMessage);
    }

    start(engine: BotEngine) {
        const handler = async (payload: Payload, reply: any, actions: any) => {
            try {
                const chatId = payload.sender.id;
                await actions.setTyping(true);

                // Parse the message.
                const message = this.parsePayload(payload);

                // Process it through the engine.
                const response = await engine.processMessage(chatId, message);

                // Respond if we need to.
                if (response) {
                    await this.respond(response, reply);
                }
            } catch (e) {
                this.bot.emit('error', e);
            }

            await actions.setTyping(false);
            await actions.markRead();
        };

        this.bot.on('message', handler);
        this.bot.on('postback', handler);

        return () => {
            this.bot.off('message', handler);
            this.bot.off('postback', handler);
        };
    }
}
