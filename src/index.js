import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import mqtt from "mqtt";

/*
 * OpenVarde identity
 */

const DATA_DIR = process.env.OPENVARDE_DATA_DIR || "/var/lib/openvarde";

const NODE_FILE = path.join(DATA_DIR, "node.json");

function loadNodeId() {
  if (!fs.existsSync(NODE_FILE)) {
    throw new Error(`OpenVarde node identity not found: ${NODE_FILE}`);
  }

  let data;

  try {
    data = JSON.parse(fs.readFileSync(NODE_FILE, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read OpenVarde node identity: ${error.message}`);
  }

  if (!data.node_id) {
    throw new Error(`${NODE_FILE} does not contain node_id`);
  }

  return data.node_id;
}

const NODE_ID = loadNodeId();

/*
 * Configuration
 */

const GPSD_HOST = process.env.GPSD_HOST || "gpsd";

const GPSD_PORT = Number(process.env.GPSD_PORT || 2947);

const MQTT_URL = process.env.MQTT_URL || "mqtt://mqtt:1883";

const MQTT_USERNAME = process.env.MQTT_USERNAME || undefined;

const MQTT_PASSWORD = process.env.MQTT_PASSWORD || undefined;

const TOPIC_BASE = `openvarde/${NODE_ID}/gps`;

/*
 * MQTT
 */

console.log(`OpenVarde node identity: ${NODE_ID}`);
console.log(`MQTT broker: ${MQTT_URL}`);
console.log(`GPSD endpoint: ${GPSD_HOST}:${GPSD_PORT}`);

const mqttClient = mqtt.connect(MQTT_URL, {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,

  reconnectPeriod: 5000,
  connectTimeout: 10000,

  clientId: `openvarde-gps-${NODE_ID}`,
});

mqttClient.on("connect", () => {
  console.log("Connected to MQTT");
});

mqttClient.on("reconnect", () => {
  console.log("Reconnecting to MQTT...");
});

mqttClient.on("offline", () => {
  console.log("MQTT connection offline");
});

mqttClient.on("error", (error) => {
  console.error(`MQTT error: ${error.message}`);
});

function publish(topic, payload) {
  if (!mqttClient.connected) {
    return;
  }

  const fullTopic = `${TOPIC_BASE}/${topic}`;

  mqttClient.publish(
    fullTopic,
    JSON.stringify(payload),
    {
      qos: 0,
      retain: false,
    },
    (error) => {
      if (error) {
        console.error(`Failed publishing ${fullTopic}: ${error.message}`);
      }
    },
  );
}

/*
 * GPSD
 */

let gpsSocket = null;
let gpsBuffer = "";
let reconnectTimer = null;

function connectGpsd() {
  console.log(`Connecting to gpsd at ${GPSD_HOST}:${GPSD_PORT}...`);

  gpsSocket = net.createConnection({
    host: GPSD_HOST,
    port: GPSD_PORT,
  });

  gpsSocket.setEncoding("utf8");

  gpsSocket.on("connect", () => {
    console.log("Connected to gpsd");

    gpsBuffer = "";

    gpsSocket.write('?WATCH={"enable":true,"json":true};\n');
  });

  gpsSocket.on("data", (data) => {
    gpsBuffer += data;

    const lines = gpsBuffer.split("\n");

    gpsBuffer = lines.pop() || "";

    for (const line of lines) {
      handleGpsdLine(line);
    }
  });

  gpsSocket.on("error", (error) => {
    console.error(`gpsd error: ${error.message}`);
  });

  gpsSocket.on("close", () => {
    console.log("gpsd connection closed");

    scheduleGpsdReconnect();
  });
}

function scheduleGpsdReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectGpsd();
  }, 5000);
}

function handleGpsdLine(line) {
  const trimmed = line.trim();

  if (!trimmed) {
    return;
  }

  let message;

  try {
    message = JSON.parse(trimmed);
  } catch (error) {
    console.error(`Invalid gpsd JSON: ${error.message}`);
    return;
  }

  switch (message.class) {
    case "TPV":
      publish("tpv", message);
      break;

    case "SKY":
      publish("sky", message);
      break;

    case "DEVICE":
      publish("device", message);
      break;

    default:
      break;
  }
}

/*
 * Shutdown
 */

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (gpsSocket) {
    gpsSocket.destroy();
  }

  mqttClient.end(false, () => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

/*
 * Start
 */

connectGpsd();
