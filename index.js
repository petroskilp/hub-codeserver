"use strict";

var httpProxy = require("http-proxy"),
  express = require("express"),
  cookieParser = require("cookie-parser"),
  expressSession = require("express-session"),
  bodyParser = require("body-parser"),
  Docker = require("dockerode"),
  crypto = require("crypto"),
  http = require("http"),
  passport = require("passport"),
  GithubStrategy = require("passport-github").Strategy,
  GoogleStrategy = require("passport-google-oauth").OAuth2Strategy,
  fs = require("fs"),
  path = require("path");
var nconf = require("nconf");

nconf.file("config.json");
nconf.load();

var containers = {},
  tokens = {},
  last_access = {},
  ipaddr = {},
  users = {};

var proxy = httpProxy.createProxyServer({});

proxy.on("error", function (error, req, res) {
  console.log(error);
  res.end();
});

var docker = new Docker({ socketPath: "/var/run/docker.sock" });

passport.use(
  new GithubStrategy(
    {
      clientID: nconf.get("github_clientid"),
      clientSecret: nconf.get("github_clientsecret"),
      callbackURL: nconf.get("callback_url"),
    },
    function (accessToken, refreshToken, profile, cb) {
      return cb(null, profile);
    }
  )
);

passport.serializeUser(function (user, cb) {
  users[user.id] = user;
  cb(null, user.id);
});

passport.deserializeUser(function (obj, cb) {
  if (obj in users) {
    cb(null, users[obj]);
  } else {
    cb("ERROR: user not found", undefined);
  }
});

passport.use(
  new GoogleStrategy(
    {
      clientID: nconf.get("google_clientid"),
      clientSecret: nconf.get("google_clientsecret"),
      callbackURL: nconf.get("callback_url_google"),
    },
    function (accessToken, refreshToken, profile, done) {
      return done(null, profile);
    }
  )
);

var app = express();

app.set("views", __dirname + "/views");
app.set("view engine", "ejs");

app.use("/static", express.static("public"));

app.use(cookieParser());
app.use(bodyParser.json());
app.use(
  bodyParser.urlencoded({
    // to support URL-encoded bodies
    extended: true,
  })
);
const sessionParser = expressSession({
  secret: crypto.randomBytes(10).toString("hex"),
  resave: true,
  saveUninitialized: true,
});
app.use(sessionParser);
app.use(passport.initialize());
app.use(passport.session());

function getIP(container, callback) {
  container.inspect(function (err, data) {
    var ip = data.NetworkSettings.Networks.bridge.IPAddress;
    if (!ip) {
      getIP(container, callback);
    } else {
      callback(ip);
    }
  });
}

function waitForConn(addr, port, callback) {
  http
    .get({ host: addr, port: port, path: "/" }, function (res) {
      callback();
    })
    .on("error", function (e) {
      waitForConn(addr, port, callback);
    });
}

function buildImage(image_name, callback) {
  console.log("Building image", image_name);
  docker.buildImage(
    { context: nconf.get("images")[image_name].path },
    { t: image_name },
    function (err, response) {
      if (err) {
        console.log(err);
      } else {
        docker.modem.followProgress(response, function onFinished(
          err,
          response
        ) {
          if (err) {
            console.log(err);
          } else {
            console.log("Building image: DONE");
            callback();
          }
        });
      }
    }
  );
}

function removeContainer(container, callback) {
  container.kill(function (err, result) {
    if (err) {
      console.log(err);
      callback();
    } else {
      container.remove(function (err, result) {
        if (err) {
          console.log(err);
        }
        callback();
      });
    }
  });
}
function copyFileSync(source, target) {
  var targetFile = target;

  //if target is a directory a new file with the same name will be created
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isDirectory()) {
      targetFile = path.join(target, path.basename(source));
    }
  }

  fs.writeFileSync(targetFile, fs.readFileSync(source));
  fs.chownSync(targetFile, 1000, 1000);
}

function copyFolderRecursiveSync(source, target) {
  var files = [];

  //check if folder needs to be created or integrated
  var targetFolder = path.join(target, path.basename(source));
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder);
    fs.chownSync(targetFolder, 1000, 1000);
  }

  //copy
  if (fs.lstatSync(source).isDirectory()) {
    files = fs.readdirSync(source);
    files.forEach(function (file) {
      var curSource = path.join(source, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, targetFolder);
      } else {
        copyFileSync(curSource, targetFolder);
      }
    });
  }
}

app.get("/login", passport.authenticate("github"));
app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  function (req, res) {
    var email = req.user.emails[0].value;
    var ra = email.substring(0, email.lastIndexOf("@"));
    var dominio = email.substring(email.lastIndexOf("@") + 1);
    if (nconf.get("ralist").indexOf(ra) == -1 || nconf.get(`domainlist`).indexOf(dominio) == -1) {
      res.redirect("/deny");
      return;
    }
    if (req.user.id in tokens && tokens[req.user.id] in containers) {
      var token = tokens[req.user.id];
      var container = containers[token];
      delete containers[token];
      removeContainer(container, function () {});
    }
    reapContainers();
    var token = crypto.randomBytes(15).toString("hex");
    tokens[req.user.id] = token;
    var image_name = nconf.get("user_image")["default"];
    if (nconf.get(`user_image`)[req.user.id] != null) {
      image_name = nconf.get(`user_image`)[req.user.id];
    }
    try {
      if (!fs.existsSync(__dirname + "/users/" + ra)) {
        fs.mkdirSync(__dirname + "/users/" + ra, { recursive: true });

        fs.chownSync(__dirname + "/users/" + ra, 1000, 1000);
        copyFolderRecursiveSync(
          __dirname + "/images/vscode/.local",
          __dirname + "/users/" + ra + "/"
        );
      }
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }

    docker
      .run(
        image_name,
        [],
        undefined,
        {
          Hostconfig: {
            Memory: nconf.get(`images`)[image_name].max_memory,
            DiskQuota: nconf.get(`images`)[image_name].disk_quota,
            Binds: [__dirname + "/users/" + ra + ":/home/academico:z"],
          },
        },
        function (err, data, container) {
          console.log(err);
        }
      )
      .on("container", function (container) {
        containers[token] = container;
        getIP(container, function (ip) {
          waitForConn(ip, nconf.get(`images`)[image_name].port, function () {
            ipaddr[token] = ip + ":" + nconf.get(`images`)[image_name].port;
            res.redirect("/");
          });
        });
      });
  }
);

app.get(
  "/auth/github/callback",
  passport.authenticate("github", { failureRedirect: "/login" }),
  function (req, res) {
    if (nconf.get(`whitelist`).indexOf(req.user.id) == -1) {
      res.redirect("/deny");
      return;
    }
    if (req.user.id in tokens && tokens[req.user.id] in containers) {
      var token = tokens[req.user.id];
      var container = containers[token];
      delete containers[token];
      removeContainer(container, function () {});
    }
    reapContainers();

    var token = crypto.randomBytes(15).toString("hex");
    tokens[req.user.id] = token;
    var image_name = nconf.get(`user_image`)[req.user.id];

    try {
      fs.mkdirSync(__dirname + "/users/" + req.user.id, { recursive: true });
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }

    docker
      .run(
        image_name,
        [],
        undefined,
        {
          Hostconfig: {
            Memory: nconf.get(`images`)[image_name].max_memory,
            DiskQuota: nconf.get(`images`)[image_name].disk_quota,
            Binds: [__dirname + "/users/" + req.user.id + ":/home/project"],
          },
        },
        function (err, data, container) {
          console.log(err);
        }
      )
      .on("container", function (container) {
        containers[token] = container;
        getIP(container, function (ip) {
          waitForConn(ip, nconf.get(`images`)[image_name].port, function () {
            ipaddr[token] = ip + ":" + nconf.get(`images`)[image_name].port;
            res.redirect("/");
          });
        });
      });
  }
);

app.get("/deny", function (req, res) {
  res.render("deny", { user: req.user });
});
app.get("/about", function (req, res) {
  res.render("about", { user: req.user });
});
app.get("/home", function (req, res) {
  res.render("home", { user: req.user });
});
app.get("/adm", function (req, res) {
  if (typeof req.user === 'undefined' || req.user === null) {
    res.redirect("/home");
    return;
  }
  nconf.load();
  var email = req.user.emails[0].value;
  var ra = email.substring(0, email.lastIndexOf("@"));
  var dominio = email.substring(email.lastIndexOf("@") + 1);
  if (nconf.get(`admlist`).indexOf(ra) == -1 || dominio != "uepg.br") {
    res.redirect("/deny");
  } else {
    res.render("adm", {
      user: req.user,
      ralist: JSON.stringify(nconf.get(`ralist`)),
    });
  }
});
app.post("/adm", function (req, res) {
  if (!req.user) {
    res.redirect("/home");
  }
  var email = req.user.emails[0].value;
  var ra = email.substring(0, email.lastIndexOf("@"));
  var dominio = email.substring(email.lastIndexOf("@") + 1);
  if (nconf.get(`admlist`).indexOf(ra) == -1 || dominio != "uepg.br") {
    res.redirect("/deny");
  } else {
    nconf.set("ralist", JSON.parse(req.body.ralist));
    nconf.save();
    res.redirect("/adm");
  }
});

app.get("/logout", function (req, res) {
  req.logout();
  res.redirect("/home");
});

app.get("/*", function (req, res) {
  if (req.user) {
    var email = req.user.emails[0].value;
    var ra = email.substring(0, email.lastIndexOf("@"));
    var dominio = email.substring(email.lastIndexOf("@") + 1);
    if (nconf.get(`ralist`).indexOf(ra) == -1 || nconf.get(`domainlist`).indexOf(dominio) == -1) {
      res.redirect("/deny");
    } else if (
      req.user &&
      req.user.id in tokens &&
      tokens[req.user.id] in containers
    ) {
      last_access[tokens[req.user.id]] = new Date().getTime();
      proxy.web(req, res, { target: "http://" + ipaddr[tokens[req.user.id]] });
    } else {
      res.redirect("/home");
    }
  } else {
    res.redirect("/home");
  }
});

function exitHandler() {
  for (var token in containers) {
    var container = containers[token];
    delete containers[token];
    removeContainer(container, function () {
      exitHandler();
    });

    return;
  }
  process.exit();
}

function reapContainers() {
  var timestamp = new Date().getTime();
  for (var token in containers) {
    if (timestamp - last_access[token] > nconf.get(`time_out`)) {
      console.log(token, "has timed out");
      var container = containers[token];
      delete containers[token];

      removeContainer(container, function () {
        reapContainers();
      });

      return;
    }
  }
}

process.on("exit", exitHandler.bind());
process.on("SIGINT", exitHandler.bind());

var server = http.createServer(app);

server.on("upgrade", function (req, socket, head) {
  sessionParser(req, {}, () => {
    if (req.session.passport) {
      var userid = req.session.passport.user;
      last_access[tokens[userid]] = new Date().getTime();
      proxy.ws(req, socket, head, { target: "ws://" + ipaddr[tokens[userid]] });
      socket.on("data", function () {
        last_access[tokens[userid]] = new Date().getTime();
      });
    }
  });
});

server.on("error", (err) => console.log(err));

buildImage("vscode-hub", function () {
  //buildImage("theia-hub", function() {
  //buildImage("terminado-hub", function() {
  server.listen(nconf.get(`port`));
  console.log("Server started in port: " + nconf.get(`port`));
  //});
  //});
});

setInterval(reapContainers, nconf.get(`time_out`));
