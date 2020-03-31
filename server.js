const { createServer } = require('http');
const Router = require('./router');
const ecstatic = require('ecstatic');

const router = new Router();
const defaultHeaders = {'Content-Type': 'text/plain'};

class Game {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = {};
        this.messageQ = [];
        this.nextMessageId = 0;
        this.version = 0;
    }

    addPlayer(name) {
        this.players[name] = true;
        this.messageQ.push({
            text: `Welcome, <span class="mention">${name}</span>`,
            from: '*',
            type: 'BOT'
        });
        this.version++;
    }

    pushMessage(message) {
        this.messageQ.push(message);
        this.version++;
    }

    getGameState(page, from) {
        if (from) {
            this.players[from] = this.version;
        }

        return {
            players: Object.keys(this.players),
            messages: from ? this.messageQ.slice(page) : [],
            version: this.version
        };
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
        server.updated(roomId);
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
        if (name in server.rooms[roomId].players) {
            return {status: 409, body: `${name} already exists. Try another!`};
        }
        
        server.rooms[roomId].addPlayer(name);
        server.updated(roomId);

        return {status: 201};
    }
});

// get game state
router.add('GET', /^\/rooms\/([^\/]+)$/, async (server, roomId, request) => {
    let tag = /(\d+)/.exec(request.headers['if-none-match']);
    let wait = /wait=(\d+)/.exec(request.headers['prefer']);

    if (!wait || (!tag && tag[1] != server.rooms[roomId].version)) {
        return {
            body: JSON.stringify(server.rooms[roomId].getGameState(request.queryParams.get('page'), request.queryParams.get('from')))
        };
    }

    if (request.queryParams.get('from')) {
        if (request.queryParams.get('page') < server.rooms[roomId].messageQ.length) {
            return {
                body: JSON.stringify(server.rooms[roomId].getGameState(request.queryParams.get('page'), request.queryParams.get('from')))
            };
        }
    }

    return server.waitForChanges(wait[1], roomId, request.queryParams);
});

// chat
router.add('POST', /^\/rooms\/([^\/]+)\/chat$/, async (server, roomId, request) => {
    if (!roomId in server.rooms) {
        return {status: 409, body: `${roomId} doesn't exist.`};
    } else {
        console.log('chat received');
        
        let message = JSON.parse(await readStream(request));
        server.rooms[roomId].pushMessage(message);
        server.updated(roomId);

        return {status: 201};
    }
});

class Server {
    constructor() {
        this.rooms = {};
        this.waiting = {};

        let fileServer = ecstatic({root: './public'});
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
        // blocks?
        console.log(`listening on port ${port}...`);
        this.server.listen(port);
    }

    stop() {
        this.server.close();
    }

    waitForChanges(time, roomId, queryParams) {
        return new Promise(resolve => {
            resolve.queryParams = queryParams;
            this.waiting[roomId].push(resolve);

            setTimeout(() => {
                if (!this.waiting[roomId].includes(resolve)) {
                    return;
                }
                this.waiting[roomId] = this.waiting[roomId].filter(r => r != resolve);
                resolve({status: 201, body: JSON.stringify(this.rooms[roomId].getGameState(queryParams.get('page'), queryParams.get('from')))});
            }, time * 1000);
        });
    }

    updated(roomId) {
        this.waiting[roomId].forEach(resolve => {
            let response = {
                body: JSON.stringify(this.rooms[roomId].getGameState(resolve.queryParams.get('page'), resolve.queryParams.get('from')))
            };

            resolve(response);
        });

        this.waiting[roomId] = [];
    }
}

let server = new Server();
server.start(5000);