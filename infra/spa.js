function handler(event) {
    var request = event.request;
    if (request.uri === "/" || /^\/invite\/[-_a-zA-Z0-9]+\/?$/.test(request.uri)) {
        request.uri = "/index.html";
    }
    return request;
}
