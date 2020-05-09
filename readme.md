# @bot-engine/channel-messenger
A [bot-engine](https://github.com/jcgurango/bot-engine) channel for Facebook messenger. Postbacks are sent as quick replies.

## Installation
Install via npm:

```
npm install --save @bot-engine/channel-messenger
```

Install from source:

```
git clone https://www.github.com/jcgurango/bot-engine-channel-messenger
cd bot-engine-channel-messenger
npm install
npm run build
```

## Usage
To use the channel, you need a web server for FB to send messages and postbacks to. Then you can add the messenger middleware to it. This package uses the `messenger-bot` package internally. Here's an example using `express`.

```
const { BotEngine, InMemorySessionManager } = require('@bot-engine/core');

const engine = new BotEngine(new InMemorySessionManager(), {
    // Your default flow.
});

// Register other flows and plugins.

const MessengerChannel = require('@bot-engine/channel-messenger').default;
const express = require('express');

const messengerChannel = new MessengerChannel({
    token: 'YOUR_TOKEN',
    verify: 'YOUR_VERIFICATION_TOKEN',
    app_secret: 'YOUR_APP_SECRET',
});

engine.register(messengerChannel);

const app = express();

app.use(messengerChannel.middleware());

app.listen(3000, () => {
    console.log('Listening...');
});

engine.start();
```
