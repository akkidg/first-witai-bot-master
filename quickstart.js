'use strict';

let Wit = null;
let interactive = null;
let log = null;

var capital = "";
var weatherObject = "";

// defining constants

const 
  bodyParser = require('body-parser'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),  
  request = require('request');

var app = express();
app.set('port', process.env.PORT || 5000);
app.use(bodyParser.json({ verify: verifyRequestSignature }));

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = process.env.MESSENGER_APP_SECRET;

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = process.env.MESSENGER_VALIDATION_TOKEN;

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;

// URL where the app is running (include protocol). Used to point to scripts and 
// assets located at this address. 
const SERVER_URL = process.env.SERVER_URL;

const accessToken = process.env.WIT_TOKEN;

const WEATHER_API_KEY = process.env.WEATHER_MAP_API_KEY;

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

try {
  // if running from repo
  Wit = require('../').Wit;
  log = require('../').log;
} catch (e) {
  Wit = require('node-wit').Wit;
  log = require('node-wit').log;
}

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

// Setting up our bot
/*const wit = new Wit({
  accessToken: accessToken,
  actions,
  logger: new log.Logger(log.INFO)
});*/

/*const accessToken = (() => {
  if (process.argv.length !== 3) {
    console.log('usage: node examples/basic.js <wit-access-token>');
    process.exit(1);
  }
  return process.argv[2];
})();*/

// Our bot actions
const actions = {
  send(request, response) {
    const {sessionId, context, entities} = request;
    const {text, quickreplies} = response;

    const id = sessions[sessionId].fbid;
    var body;
    if (id) {
      return new Promise(function(resolve, reject){

        if((!context.missingLocation && context.country) || context.missingLocation){
            body = JSON.stringify({
              recipient: { id },
              message: { text },
            });
        }else if(!context.missingLocation && context.forecast){
            body = JSON.stringify({
              recipient: { id },
              message: {text},
            });
        }

        return fbMessage(body)
        .then(() => null)
        .catch((err) => {
          console.error(
            'Oops! An error occurred while forwarding the response to',
            id,
            ':',
            err.stack || err
          );
        });       
        return resolve();
      });
    }else {
      console.error('Oops! Couldn\'t find user for session:', sessionId);
      // Giving the wheel back to our bot
      return Promise.resolve()
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
  getWeather({context, entities}) {

    return new Promise(function(resolve, reject){ 

      const location = firstEntityValue(entities,'location');

      if (location) {
      getWeatherForecast(location,function(){
        console.log("forecast returned : " + weatherObject); 
        if(weatherObject != ""){
          context.forecast = weatherObject;
          delete context.missingLocation; 
          return resolve(context);
        }else{
          context.missingLocation = true;
          delete context.forecast; 
          return resolve(context);
        }
      }); 
      } else {
        console.log("excuted else from main ");
        context.missingLocation = true;
        delete context.forecast;

        return resolve(context);
      }
    });    
  },
  // You should implement your custom actions here
  // See https://wit.ai/docs/quickstart
};

// Setting up our bot
const wit = new Wit({
  accessToken: accessToken,
  actions,
  logger: new log.Logger(log.INFO)
});

const fbMessage = (body) => {
  
  const qs = 'access_token=' + encodeURIComponent(PAGE_ACCESS_TOKEN);
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
            const body = JSON.stringify({
              recipient: { id:sender },
              message: 'Sorry I can only process text messages for now.',
            });
            fbMessage(body)
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

//const client = new Wit({accessToken, actions});

// returns capital value

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

// returns weather forecast of city

var getWeatherForecast = function(city,callback) {

  console.log("city is: " + city);
  const url = "http://api.openweathermap.org/data/2.5/weather?q=" + city + "&units=metric&appid=" + WEATHER_API_KEY;
  
  request(url, function (error, response, body) {
    if (!error && response.statusCode == 200) {

        var newJsonObject = JSON.parse(body);
        if(newJsonObject.hasOwnProperty('message')){
            weatherObject = "";
            callback();
        }else{
          //var weatherObjectArray = newJsonObject.weather;
          weatherObject = generateTemplateObject(newJsonObject);
          callback();
        }
     }else{
        console.log("error in api " + error);
        weatherObject = "";
        callback();
     }
  });
};

function generateTemplateObject(jsonObject){

  var weatherObjectArray = jsonObject.weather;
  var mainObject = jsonObject.main;
  var windObject = jsonObject.wind;

  var json = {
              attachment:{
                type: "template",
                payload: {
                  template_type: "generic",
                  elements: [{
                    title: "Weather Forecast for " + jsonObject.name + " will be " + weatherObjectArray[0].description,
                    subtitle:"Temp. : " + mainObject.temp + "\n Wind Speed: " + windObject.speed  + "\n Humidity: " + mainObject.humidity,
                    image_url: "http://openweathermap.org/img/w/" + weatherObjectArray[0].icon + ".png",
                    buttons: [{
                      type: "postback",
                      payload: "DEVELOPER_DEFINED_PAYLOAD_FOR_PARTY_SPECIAL_BACK",
                      title: "Back"
                    }],
                  }]
                  }
                }
              };
  
  return json;   

}



// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

