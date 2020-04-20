const { createServer } = require('http');
const Router = require('./router');
const ecstatic = require('ecstatic');

const router = new Router();
const defaultHeaders = {'Content-Type': 'text/plain'};

const MAX_PRIVATE_CHANNELS = 3;

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
    constructor(roomId, context) {
        this.roomId = roomId;
        this.context = context;
        this.players = {};

        this.channels = {};
        this.channels.public = new Channel('public', 'broadcast');
    }

    broadcastAlert(alert) {
        for (let player of Object.values(this.players)) {
            player.pushAlert(alert);
        }
    }

    addPlayer(name) {
        this.players[name] = new Player(name);

        this.channels.public.pushMessage({
            text: `Welcome, <span class="mention">${name}.</span>`,
            from: '*',
            race: 'BOT'
        });

        this.broadcastAlert({
            code: 'PLAYER_JOIN',
            new: name
        });

        // heartbeat every 5 sec
        if (!this.heartbeat) {
            console.log(`${this.roomId} heartbeat started`);
            this.heartbeat = setInterval(() => {
                const now = Date.now() / 1000;
                let dead = [];

                for (let player of Object.values(this.players)) {
                    if (now - player.lastRequestMade > 120) {
                        dead.push(player.name);
                        delete this.players[player.name];

                        // send message to releveant channels
                        for (let c of Object.values(this.channels)) {
                            if (c.id == 'public' || c.members.has(player.name)) {
                                c.pushMessage({
                                    text: `<span class="mention">${player.name}</span> got disconnected.`,
                                    from: '*',
                                    race: 'BOT'
                                });
                            }
                        }
                    }
                }

                if (Object.keys(this.players).length == 0) {
                    this.cleanup();
                    return;
                } 

                if (dead.length > 0) {
                    this.broadcastAlert({
                        code: 'PLAYER_LEAVE',
                        dead: dead
                    });
                    this.context.wakeup(this.roomId, 'ALERT');
                }
            }, 5 * 1000);
        }
    }

    hasPlayer(name) {
        return this.players.hasOwnProperty(name);
    }

    deletePlayer(name) {
        delete this.players[name];

        if (Object.keys(players).length == 0) {
            this.cleanup();
            return;
        } 

        const msg = {
            text: `<span class="mention">${name}.</span> got disconnected.`,
            from: '*',
            race: 'BOT'
        };

        this.channels.public.pushMessage(msg);
        // send message to relevant channels
        for (let c of Object.values(this.channels)) {
            if (c.id == 'public') {
                continue;
            }

            if (c.members.has(name)) {
                c.pushMessage(msg);
            }
        }

        this.broadcastAlert({
            code: 'PLAYER_LEAVE',
            dead: [name]
        });
    }

    pushMessage(message) {
        let id = message.to == 'everyone' ? 'public' : channelId(message.from, message.to);

        if (message.from in this.channels) {
            message.to = '???';
            this.channels[id].pushMessage(message);
        }

        if (id in this.channels) {
            this.channels[id].pushMessage(message);
            return true;
        }

        return false;
    }

    getNewMessages(channels) {
        let newMessages = {};
        let gotNew = false;

        for (let c of channels) {
            newMessages[c.id] = this.channels[c.id].getMessages(c.page);
            
            if (newMessages[c.id].length > 0) {
                gotNew = true;
            }
        }

        if (gotNew) {
            return newMessages;
        } else {
            return null;
        }
    }

    getGameData() {
        return {
            players: Object.keys(this.players)
        };
    }

    addPrivateChannel(a, b) {
        if (!this.players.hasOwnProperty(a)) {
            return {ok: false, msg: `${a} does not exist.`};
        } if (!this.players.hasOwnProperty(b)) {
            return {ok: false, msg: `${b} does not exist`};
        }

        if (this.players[a].numPrivateChannels == MAX_PRIVATE_CHANNELS) {
            return {ok: false, msg: 'You cannot open more than 3 private channels.'};
        }
        if (this.players[b].numPrivateChannels == MAX_PRIVATE_CHANNELS) {
            return {ok: false, msg: `${b} already at maxmium channel capacity.`};
        }

        let id = channelId(a, b);
        if (this.channels.hasOwnProperty(id)) {
            return {ok: false, msg: `channel between ${a} and ${b} already established.`}
        }

        this.channels[id] = new Channel(id, 'narrowcast', new Set([a, b]));
        
        this.channels[a] = new Channel(a, 'narrowcast', new Set(a));
        this.channels[b] = new Channel(b, 'narrowcast', new Set(b));

        // alert a and b of new channel creation
        this.players[a].pushAlert({
            code: 'NEW_CHANNEL',
            id: id,
            other: b,
            members: [a, b]
        });
        this.players[a].numPrivateChannels++;

        if (a != b) {
            this.players[b].pushAlert({
                code: 'NEW_CHANNEL',
                id: id,
                other: a,
                members: [a, b]
            });
            this.players[b].numPrivateChannels++;
        }

        return {ok: true, msg: null};
    }

    deletePrivateChannel(a, b) {
        let id = channelId(a, b);
        if (!this.channels.hasOwnProperty(id)) {
            return {ok: false, msg: `channel between ${a} and ${b} does not exist.`}
        }

        // alert a and b of new channel creation
        this.players[a].pushAlert({
            code: 'DELETE_CHANNEL',
            id: id,
        });
        this.players[a].numPrivateChannels--;

        if (a != b) {
            this.players[b].pushAlert({
                code: 'DELETE_CHANNEL',
                id: id,
            });
            this.players[b].numPrivateChannels--;
        }

        delete this.channels[id];
        delete this.channels[a];
        delete this.channels[b];

        return {ok: true, msg: null};
    }

    snoopChannel(name, id) {
        if (this.channels.hasOwnProperty(id)) {
            this.channels[id].addSnooper(name);
            return true;
        }

        return false;
    }

    hasAlertsFor(name) {
        return this.players[name].alerts.length > 0;
    }

    keepPlayerAlive(name) {
        this.players[name].keepAlive();
    }

    cleanup() {
        console.log('cleaning up', this.roomId);
        clearInterval(this.heartbeat);
        delete this.context.rooms[this.roomId];
        delete this.context.waiting[this.roomId];
    }
}

/**
 * Medium of communication
 */
class Channel {
    constructor(id, mode, members) {
        this.id = id;
        this.messageQ = [];
        this.mode = mode;

        if (this.mode == 'narrowcast') {
            this.members = members;
        }

        this.snoopers = [];
    }

    pushMessage(message) {
        this.messageQ.push(message);
    }

    getMessages(page=0) {
        return this.messageQ.slice(page);
    }

    addSnooper(name) {
        this.snoopers.push(name);
    }
}

/**
 * holds player data
 */
class Player {
    constructor(name) {
        this.name = name;
        this.lastRequestMade = Date.now() / 1000;

        // mechanism for notifying players
        this.alerts = [];
        this.numPrivateChannels = 0;
    }

    pushAlert(alert) {
        this.alerts.push(alert);
    }

    consumeAlerts() {
        let temp = this.alerts;
        this.alerts = [];

        return temp;
    }

    keepAlive() {
        this.lastRequestMade = Date.now() / 1000;
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
    if (server.rooms.hasOwnProperty(roomId)) {
        return {status: 409, body: `${roomId} already exists. Try another name!`};
    }

    server.rooms[roomId] = new Game(roomId, server);
    server.waiting[roomId] = [];

    return {status: 201};
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
    }

    let name = await readStream(request);

    if (server.rooms[roomId].hasPlayer(name)) {
        return {status: 409, body: `${name} already exists. Try another name!`};
    }
    
    server.rooms[roomId].addPlayer(name);
    server.wakeup(roomId, 'ALERT');

    return {status: 201};
});

// leave room
router.add('DELETE', /^\/rooms\/([^\/]+)\/players$/, async (server, roomId, request) => {
    console.log('leaving');

    if (!roomId in server.rooms) {
        return {status: 409, body: `${roomId} doesn't exist.`};
    }
    
    let name = await readStream(request);

    if (!server.rooms[roomId].hasPlayer(name)) {
        return {status: 409, body: 'Something went wrong, cannot leave'};
    }

    server.rooms[roomId].deletePlayer(name);
    server.wakeup(roomId, 'ALERT');

    return {status: 200};
});

// get game state or new messages
router.add('GET', /^\/rooms\/([^\/]+)$/, async (server, roomId, request) => {
    if (!server.rooms.hasOwnProperty(roomId)) {
        return {status: 409, body: `${roomId} doesn't exist.`};
    }

    let room = server.rooms[roomId];
    let me = request.queryParams.get('from');
    const ghost = (me == undefined);

    // console.log(ghost);

    if (!ghost) {
        room.keepPlayerAlive(me);
        // if there are any new alerts
        if (room.hasAlertsFor(me)) {

            return {
                body: JSON.stringify({
                    type: 'ALERT',
                    alerts: room.players[me].consumeAlerts()
                }) 
            };
        }
    }

    let channels;
    // check for messages in subscribed channels
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

    let wait = /wait=(\d+)/.exec(request.headers['prefer']);
    if (!wait) {
        let gameData = server.rooms[roomId].getGameData();
        gameData.type = 'GAME_DATA';

        return {
            body: JSON.stringify(gameData)
        };
    }

    request.myparams = {
        from: me,
        channels: channels ? channels : [],
        ghost: ghost,
        origin: `GET /rooms/${roomId}`
    };
    return server.wait(wait[1], roomId, request);
});

// add message to a channel
router.add('POST', /^\/rooms\/([^\/]+)\/messages$/, async (server, roomId, request) => {
    if (!roomId in server.rooms) {
        return {status: 409, body: `${roomId} doesn't exist.`};
    }

    let message = JSON.parse(await readStream(request));
    server.rooms[roomId].pushMessage(message);
    server.wakeup(roomId, 'NEW_MESSAGES');

    return {status: 201};
});

// add private channel
router.add('POST', /^\/rooms\/([^\/]+)\/channels$/, async (server, roomId, request) => {
    if (!roomId in server.rooms) {
        return {status: 409, body: `${roomId} doesn't exist.`};
    }

    let from = request.queryParams.get('from');
    let to = request.queryParams.get('to');

    let {ok, msg} = server.rooms[roomId].addPrivateChannel(from , to);

    if (ok) {
        server.wakeup(roomId, 'ALERT', whitelist=new Set([from, to]));
        return {status: 201};
    } else {
        return {status: 409, body: msg};
    }
});

// delete private channel
router.add('DELETE', /^\/rooms\/([^\/]+)\/channels$/, async (server, roomId, request) => {
    if (!roomId in server.rooms) {
        return {status: 409, body: `${roomId} doesn't exist.`};
    }

    let from = request.queryParams.get('from');
    let to = request.queryParams.get('to');

    let {ok, msg} = server.rooms[roomId].deletePrivateChannel(from, to);

    if (ok) {
        server.wakeup(roomId, 'ALERT', whitelist=new Set([from, to]));
        return {status: 201};
    } else {
        return {status: 409, body: msg};
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
                this.waiting[roomId] = this.waiting[roomId].filter(r => {
                    if (r != resolve) {
                        return true;
                    }

                    resolve({
                        status: 204 // no content
                    });
                    return false;
                })
            }, time * 1000);
        });
    }

    wakeup(roomId, event, whitelist) {
        switch (event) {
            case 'NEW_MESSAGES':
                this.waiting[roomId] = this.waiting[roomId].filter(resolve => {
                    if (whitelist && !whitelist.has(resolve.myparams.from)) {
                        return true;
                    }

                    // if user got disconnected
                    if (!this.rooms[roomId].players.hasOwnProperty(resolve.myparams.from)) {
                        return false;
                    }

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
            case 'ALERT':
                this.waiting[roomId] = this.waiting[roomId].filter(resolve => {
                    if (resolve.myparams.ghost) {
                        let gameData = this.rooms[roomId].getGameData();
                        gameData.type = 'GAME_DATA';

                        resolve({body: JSON.stringify(gameData)});
                        return false;
                    }

                    let me = resolve.myparams.from;

                    // if user got disconnected
                    if (!this.rooms[roomId].players.hasOwnProperty(me)) {
                        return false;
                    }

                    if (whitelist && !whitelist.has(me)) {
                        return true;
                    }

                    if (!this.rooms[roomId].hasAlertsFor(me)) {
                        return true;
                    }
        
                    resolve({
                        body: JSON.stringify({
                            type: event,
                            alerts: this.rooms[roomId].players[me].consumeAlerts()
                        })
                    });
                    
                    return false;
                });
                break;
            default:
                this.waiting[roomId].forEach(resolve => {
                    resolve({status: 204});
                });
                this.waiting[roomId] = [];
                return;
        }
    }
}

let server = new Server();
server.start(5000);