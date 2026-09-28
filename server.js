const http = require('http'), fs = require('fs');
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  fs.createReadStream(__dirname + '/index.html').pipe(res);
}).listen(process.env.PORT || 3000);
