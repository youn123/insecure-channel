const url = require('url');

module.exports = class Router {
    constructor() {
        this.routes = [];
    }

    add(method, url, handler) {
        this.routes.push({method, url, handler});
    }

    resolve(context, request) {
        let parsed = new url.URL(request.url, 'http://' + request.headers.host);

        let path = parsed.pathname;
        let queryParams = parsed.searchParams;

        // object destructuring
        for (let {method, url, handler} of this.routes) {
            let match = url.exec(path);

            if (!match || request.method != method) continue;
            let urlParts = match.slice(1).map(decodeURIComponent);
            return handler(context, ...urlParts, queryParams, request);
        }

        return null;
    }
};