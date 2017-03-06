'use strict';

let Wit = null;
let interactive = null;

var capital = "";

// defining constants

const 
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),  
  request = require('request');

var app = express();
app.set('port', process.env.PORT || 5000);
app.use(bodyParser.json({ verify: verifyRequestSignature }));

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ? 
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and 
// assets located at this address. 
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

const WIT_TOKEN = process.env.WIT_TOKEN;

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

try {
  // if running from repo
  Wit = require('../').Wit;
  interactive = require('../').interactive;
} catch (e) {
  Wit = require('node-wit').Wit;
  interactive = require('node-wit').interactive;
}

var request = require('request');

// This will contain all user sessions.
// Each session has an entry:
// sessionId -> {fbid: facebookUserId, context: sessionState}
const sessions = {};

// This will contain all user sessions.
// Each session has an entry:
// sessionId -> {fbid: facebookUserId, context: sessionState}

const findOrCreateSession = (fbid) => {
  let sessionId;

  Object.keys(sessions).forEach(k => {
    if(sessions[k].fbid === fbid){
      sessionId = k;
    }
  });

  if(!sessionId){
    // No session found for user fbid, let's create a new one
    sessionId = new Date().toISOString();
    sessions[sessionId] = {fbid:fbid, context:{}};
  }
  return sessionId;
};

/*const accessToken = (() => {
  if (process.argv.length !== 3) {
    console.log('usage: node examples/basic.js <wit-access-token>');
    process.exit(1);
  }
  return process.argv[2];
})();*/

const fbMessage = (id,text) => {
  const body = JSON.stringify({
      recipient: { id },
      message: { text },
  });
  context qs = 'access_token=' + encodeURIComponent(PAGE_ACCESS_TOKEN);
  return fetch('https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
  })
  .then(rsp => rsp.json())
  .then(json => {
     if (json.error && json.error.message) {
      throw new Error(json.error.message);
    }
    return json;
  });
}; 

/*
 * Use your own validation token. Check that the token used in the Webhook 
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }  
});

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook', function (req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(entry => {
      entry.messaging.forEach(event => {
        if (event.message && !event.message.is_echo) {
            // Yay! We got a new message!
          // We retrieve the Facebook user ID of the sender
          const sender = event.sender.id;

          // We retrieve the user's current session, or create one if it doesn't exist
          // This is needed for our bot to figure out the conversation history
          const sessionId = findOrCreateSession(sender);

          // We retrieve the message content
          const {text, attachments} = event.message;

          if(attachments){
            fbMessage(sender, 'Sorry I can only process text messages for now.')
          }else if(text){
            // We received a text message

            // Let's forward the message to the Wit.ai Bot Engine
            // This will run all actions until our bot has nothing left to do
            wit.runActions(
              sessionId, // the user's current session
              text, // the user's message
              sessions[sessionId].context // the user's current session state
            ).then((context) => {
              // Our bot did everything it has to do.
              // Now it's waiting for further messages to proceed.
              console.log('Waiting for next user messages');

              // Based on the session state, you might want to reset the session.
              // This depends heavily on the business logic of your bot.
              // Example:
              // if (context['done']) {
              //   delete sessions[sessionId];
              // }

              // Updating the user's current session state
              sessions[sessionId].context = context;
            })
            .catch((err) => {
              console.error('Oops! Got an error from Wit: ', err.stack || err);
            });
          }
        }else {
          console.log('received event', JSON.stringify(event));
        }
      });  
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've 
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});


/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an 
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

// Quickstart example
// See https://wit.ai/ar7hur/quickstart

const firstEntityValue = (entities, entity) => {
  const val = entities && entities[entity] &&
    Array.isArray(entities[entity]) &&
    entities[entity].length > 0 &&
    entities[entity][0].value
  ;
  console.log('entities values.', val);
  if (!val) {
    return null;
  }
  return typeof val === 'object' ? val.value : val;
};

const actions = {
  send(request, response) {
    const {sessionId, context, entities} = request;

    const recipientId = sessions[sessionId].fbid;

    if(recipientId){      
      const {text, quickreplies} = response;

      return new Promise(function(resolve, reject){      
        return fbMessage(recipientId, text)
        .then(() => null)
        .catch((err) => {
          console.error(
            'Oops! An error occurred while forwarding the response to',
            recipientId,
            ':',
            err.stack || err
          );
        });
        console.log('sending...', JSON.stringify(response));
        return resolve();
      });
    }
  },  
  getCapital({context, entities}) {

    return new Promise(function(resolve, reject){ 

      const location = firstEntityValue(entities,'location');

      if (location) {
      getCapitalValue(location,function(){
        console.log("capital returned : " + capital); 
        if(capital != ""){
          context.country = capital;
          delete context.missingLocation; 
          return resolve(context);
        }else{
          context.missingLocation = true;
          delete context.country; 
          return resolve(context);
        }
      }); 
      
      } else {
        console.log("excuted else from main ");
        context.missingLocation = true;
        delete context.country;

        return resolve(context);
      }
    });
    
  },
};

const client = new Wit({WIT_TOKEN, actions});
interactive(client);

var getCapitalValue = function(country,callback) {

  console.log("country is: " + country);
  const url = "https://restcountries.eu/rest/v2/name/" + country;

  request(url, function (error, response, body) {
    if (!error && response.statusCode == 200) {
        var jsonObject =  JSON.parse(body);
        if(jsonObject.hasOwnProperty('status')){
            capital = "";
            callback();
        }else{
          console.log("capital found" + jsonObject[0].capital);
          capital = jsonObject[0].capital;
          callback();
        }
     }else{
        console.log("capital not found");
        capital = "";
        callback();
     }
  });
};

app.listen(PORT);
console.log('Listening on :' + PORT + '...');

