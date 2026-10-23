// Success = the sample server holds an upload with this run's idempotency key (polls up to 30 s).
var ok = false;
for (var i = 0; i < 30 && !ok; i++) {
  ok = JSON.parse(http.get(SERVER + '/export').body).uploads.some(function (u) { return u.key === output.key; });
  if (!ok) { var t = Date.now(); while (Date.now() - t < 1000) {} } // no Thread in Maestro's JS: spin 1 s
}
if (!ok) throw new Error('no upload with key ' + output.key + ' on the sample server');
