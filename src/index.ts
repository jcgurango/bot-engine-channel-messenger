import { IChannel, BotEngine, IIncomingMessage, IncomingMessageType, IStep, OutgoingMessageType, IOutgoingMessage } from '@bot-engine/core';
import { Payload, QuickReplyPayload, MessagePayload, PostbackPayload, SendMessageData, SendApiMessage } from 'facebook-messenger-api-types';
import { IBotOptions } from './interfaces';
import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';

export default class MessengerChannel implements IChannel {
    options: IBotOptions;
    processPayload: (payload: Payload) => Promise<void> = async (payload: Payload) => { };
    client: AxiosInstance;

    constructor(options: IBotOptions) {
        this.options = options;
        this.client = axios.create({
            baseURL: 'https://graph.facebook.com/v2.6/me/messages',
        });

        this.client.interceptors.request.use((request) => {
            return {
                ...request,
                params: {
                    ...(request.params || {}),
                    access_token: options.token,
                },
            };
        });
    }

    private async sendAction(recipient: string, action: string) {
        return this.client.post('', {
            recipient: {
                id: recipient,
            },
            sender_action: action,
        })
    }

    private async sendMessage(message: SendMessageData) {
        return this.client.post('', message);
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

    private parseOutgoingMessage(message: IOutgoingMessage): SendApiMessage {
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

    private async respond(recipient: string, response: IStep) {
        let lastMessage: any = {};

        // Create the response.
        if (response.messages.length > 0) {
            for (let i = 0; i < response.messages.length - 1; i++) {
                const message = response.messages[i];

                await this.sendMessage({
                    recipient: {
                        id: recipient,
                    },
                    messaging_type: 'RESPONSE',
                    message: this.parseOutgoingMessage(message),
                });
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

        await this.sendMessage({
            recipient: {
                id: recipient,
            },
            messaging_type: 'RESPONSE',
            message: lastMessage,
        });
    }

    start(engine: BotEngine) {
        this.processPayload = async (payload: Payload) => {
            let caughtError = null;

            try {
                const chatId = payload.sender.id;
                await this.sendAction(payload.sender.id, 'typing_on');

                // Parse the message.
                const message = this.parsePayload(payload);

                // Process it through the engine.
                const response = await engine.processMessage(chatId, message);

                // Respond if we need to.
                if (response) {
                    await this.respond(payload.sender.id, response);
                }
            } catch (e) {
                caughtError = e;
            }

            await this.sendAction(payload.sender.id, 'typing_off');
            await this.sendAction(payload.sender.id, 'mark_seen');

            if (caughtError) {
                throw caughtError;
            }
        };
    }

    middleware() {
        if (!this.options.verify) {
            throw new Error('A verify token is required to use middleware.');
        }

        return async (req: any, res: any, next: any) => {
            try {
                if (req.method === 'GET') {
                    const mode = req.query['hub.mode'];
                    const token = req.query['hub.verify_token'];
                    const challenge = req.query['hub.challenge'];

                    if (mode === 'subscribe' && token === this.options.verify) {
                        return res.status(200).send(challenge);
                    }
                }

                if (req.method === 'POST') {
                    const { body, rawBody } = req;

                    // Verify the signature.
                    if (this.options.appSecret) {
                        const signature = req.headers['x-hub-signature'];
                        const hmac = crypto.createHmac('sha1', this.options.appSecret.toString());
                        hmac.update(rawBody);
              
                        if (signature !== `sha1=${hmac.digest('hex')}`) {
                          return res.end(JSON.stringify({
                              status: 'not ok',
                              error: 'Message integrity check failed',
                        }));
                        }
                    }

                    if (body && body.object && body.object === 'page') {
                        // Parse the payload.
                        await Promise.all(
                            body.entry.map(async (entry: any) => {
                                if (entry.messaging) {
                                    return Promise.all(entry.messaging.map((async (message: Payload) => {
                                        await this.processPayload(message);
                                    })));
                                }
                            })
                        );

                        return res.status(200).end();
                    }
                }
            } catch (e) {
                console.error(e);
            }

            next();
        };
    }
}
