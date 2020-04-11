const { createServer } = require('http');
const Router = require('./router');
const ecstatic = require('ecstatic');

const router = new Router();
const defaultHeaders = {'Content-Type': 'text/plain'};

function channelId(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function parseChannelString(str) {
    let channels = [];

    for (let c of str.split(',')) {
        let tokens = c.split(':');
        channels.push({id: tokens[0], page: parseInt(tokens[1])});
    }

    return channels;
}

class Game {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = {};
        // only gets incremented when new players join
        this.version = 0;

        this.channels = {};
        // used for alerting people when new channels are created
        this.alerts = {};

        this.channels.public = new Channel('public');
    }

    addPlayer(name) {
        this.players[name] = true;
        this.version++;

        this.channels.public.pushMessage({
            text: `Welcome, <span class="mention">${name}.</span>`,
            from: '*',
            race: 'BOT'
        });
    }

    hasPlayer(name) {
        return (name in this.players);
    }

    pushMessage(message) {
        let id = message.to == 'everyone' ? 'public' : channelId(message.from, message.to);

        if (id in this.channels) {
            this.channels[id].pushMessage(message);
            return true;
        }

        return false;
    }

    getNewMessages(channels) {
        let newMessages = {};
        let gotNewMessages = false;

        for (let c of channels) {
            newMessages[c.id] = this.channels[c.id].getMessages(c.page);

            if (newMessages[c.id].length > 0) {
                gotNewMessages = true;
            }
        }

        if (gotNewMessages) {
            return newMessages;
        } else {
            return null;
        }
    }

    getGameState() {
        return {
            players: Object.keys(this.players),
            version: this.version
        };
    }

    addPrivateChannel(a, b) {
        if (!this.players[a] || !this.players[b]) {
            return false;
        }

        let id = channelId(a, b);
        this.channels[id] = new Channel(id);

        // alert a and b of new channel creation
        this.alerts[a] = b;
        this.alerts[b] = a;
        return true;
    }

    hasNewChannel(name) {
        if (this.alerts[name]) {
            return true;
        }

        return false;
    }

    getNewChannelId(name) {
        return channelId(name, this.alerts[name]);
    }

    clearNewChannelAlert(name) {
        this.alerts[name] = false;
    }
}

/**
 * Medium of communication
 */
class Channel {
    constructor(id) {
        this.id = id;
        this.messageQ = [];
    }

    pushMessage(message) {
        this.messageQ.push(message);
    }

    getMessages(page=0) {
        return this.messageQ.slice(page);
    }
}

// request is a readable stream
function readStream(stream) {
    return new Promise((resolve, reject) => {
        let data = '';
        stream.on('error', reject);
        stream.on('data', chunk => data += chunk.toString());
        stream.on('end', () => resolve(data));
    });
}

// add room
router.add('POST', /^\/rooms\/([^\/]+)$/, async (server, roomId, request) => {
    if (roomId in server.rooms) {
        return {status: 409, body: `${roomId} already exists. Try another name!`};
    } else {
        server.rooms[roomId] = new Game(roomId);
        server.waiting[roomId] = [];

        return {status: 201};
    }
});

// wake up room
router.add('GET', /^\/rooms\/([^\/]+)\/ping$/, async (server, roomId, request) => {
    if (roomId in server.rooms) {
        server.wakeup(roomId);
        return {status: 200};
    } else {
        return {status: 409};
    }
});

// join room w/ name
router.add('POST', /^\/rooms\/([^\/]+)\/players$/, async (server, roomId, request) => {
    if (!roomId in server.rooms) {
        return {status: 409, body: `${roomId} doesn't exist.`};
    } else {
        let name = await readStream(request);

        if (server.rooms[roomId].hasPlayer()) {
            return {status: 409, body: `${name} already exists. Try another name!`};
        }
        
        server.rooms[roomId].addPlayer(name);
        server.wakeup(roomId, event='GAME_STATE_CHANGE');

        return {status: 201};
    }
});

// get game state or new messages
router.add('GET', /^\/rooms\/([^\/]+)$/, async (server, roomId, request) => {
    let me = request.queryParams.get('from');

    // if new private channel created
    if (server.rooms[roomId].hasNewChannel(me)) {
        let id = server.rooms[roomId].getNewChannelId(me);
        server.rooms[roomId].clearNewChannelAlert(me);

        return {
            body: JSON.stringify({
                type: 'NEW_CHANNEL',
                channelId: id 
            }) 
        };
    }

    let tag = /(\d+)/.exec(request.headers['if-none-match']);
    let wait = /wait=(\d+)/.exec(request.headers['prefer']);

    // if not waiting or new player(s) joined
    if (!wait || (!tag && tag[1] != server.rooms[roomId].version)) {
        let gameState = server.rooms[roomId].getGameState();
        gameState.type = 'GAME_STATE_CHANGE';

        return {
            body: JSON.stringify(gameState)
        };
    }

    let channels = [];

    // if new messages to subscribed channels arrived;
    if (request.queryParams.get('channels')) {
        channels = parseChannelString(request.queryParams.get('channels'));
        let newMessages = server.rooms[roomId].getNewMessages(channels);

        if (newMessages) {
            newMessages.type = 'NEW_MESSAGES';
            return {
                body: JSON.stringify(newMessages)
            };
        }
    }

    request.myparams = {
        from: me,
        channels: channels
    };
    return server.wait(wait[1], roomId, request);
});

// add message to a channel
router.add('POST', /^\/rooms\/([^\/]+)\/messages$/, async (server, roomId, request) => {
    if (!roomId in server.rooms) {
        return {status: 409, body: `${roomId} doesn't exist.`};
    } else {
        console.log('chat received');
        
        let message = JSON.parse(await readStream(request));
        server.rooms[roomId].pushMessage(message);
        server.wakeup(roomId, 'NEW_MESSAGES');

        return {status: 201};
    }
});

// add private channel
router.add('POST', /^\/rooms\/([^\/]+)\/channels$/, async (server, roomId, request) => {
    if (!roomId in server.rooms) {
        return {status: 409, body: `${roomId} doesn't exist.`};
    }

    let from = request.queryParams.get('from');
    let to = request.queryParams.get('to');

    if (server.rooms[roomId].addPrivateChannel(from, to)) {
        server.wakeup(roomId, 'NEW_CHANNEL', from, to);
        return {status: 201};
    } else {
        return {status: 409, body: 'Cannot create private channel'};
    }
});

class Server {
    constructor() {
        this.rooms = {};
        this.waiting = {}; // roomId -> list of waiting requests

        let fileServer = ecstatic({root: './dist'});

        this.server = createServer((req, res) => {
            let resolved = router.resolve(this, req);
            // handlers return promises that resolve to objects
            // describing the response
            if (resolved) {
                resolved.catch(err => {
                    if (err.status != null) return err;
                    return {body: String(err), status: 500};
                }).then(({body, status = 200, headers = defaultHeaders}) => {
                    res.writeHead(status, headers);
                    res.end(body);
                });
            } else {
                fileServer(req, res);
            }
        });
    }

    start(port) {
        console.log(`listening on port ${port}...`);
        // blocks
        this.server.listen(port);
    }

    stop() {
        this.server.close();
    }

    wait(time, roomId, request) {
        return new Promise(resolve => {
            resolve.myparams = request.myparams;
            this.waiting[roomId].push(resolve);

            setTimeout(() => {
                if (!this.waiting[roomId].includes(resolve)) {
                    return;
                }

                resolve({
                    status: 204 // No content
                });
                
            }, time * 1000);
        });
    }

    wakeup(roomId, event, ...whitelist) {
        switch (event) {
            case 'NEW_MESSAGES':
                this.waiting[roomId].filter(resolve => {
                    let newMessages = this.rooms[roomId].getNewMessages(resolve.myparams.channels);
                    if (newMessages) {
                        newMessages.type = event;

                        resolve({
                            body: JSON.stringify(newMessages)
                        });

                        return false;
                    }

                    return true;
                });

                return;
            case 'NEW_CHANNEL':
                this.waiting[roomId].filter(resolve => {
                    if (whitelist.includes(resolve.myparams.from)) {
                        let response = {
                            body: JSON.stringify({
                                type: event,
                                other: whitelist[0] == resolve.myparams.from ? whitelist[1] : whitelist[0]
                            })
                        };
        
                        resolve(response);

                        // clear alerts
                        for (let player of whitelist) {
                            this.rooms[roomId].alerts[player] = false;
                        }

                        return false;
                    }
        
                    return true;
                });
            case 'GAME_STATE_CHANGE':
            default:
                let gameState = this.rooms[roomId].getGameState();
                gameState.type = event;

                let response = {
                    body: JSON.stringify(gameState)
                };
    
                this.waiting[roomId].forEach(resolve => {
                    resolve(response);
                });

                this.waiting[roomId] = [];
                return;
        }
    }
}

let server = new Server();
server.start(5000);