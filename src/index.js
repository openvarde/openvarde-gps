import net from "node:net";
import mqtt from "mqtt";

const GPSD_HOST = process.env.GPSD_HOST || "gpsd";
const GPSD_PORT = Number(process.env.GPSD_PORT || 2947);

const MQTT_URL = process.env.MQTT_URL || "mqtt://mqtt:1883";
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;

const NODE_ID = process.env.NODE_ID || "varde-01";
const TOPIC_BASE = `openvarde/${NODE_ID}/gps`;

const mqttClient = mqtt.connect(MQTT_URL, {
  username: MQTT_USERNAME || undefined,
  password: MQTT_PASSWORD || undefined,
});

mqttClient.on("connect", () => {
  console.log(`Connected to MQTT: ${MQTT_URL}`);
});

mqttClient.on("error", (error) => {
  console.error("MQTT error:", error.message);
});

const gpsd = net.createConnection(
  {
    host: GPSD_HOST,
    port: GPSD_PORT,
  },
  () => {
    console.log(`Connected to gpsd: ${GPSD_HOST}:${GPSD_PORT}`);

    gpsd.write('?WATCH={"enable":true,"json":true};\n');
  },
);

let buffer = "";

gpsd.on("data", (data) => {
  buffer += data.toString();

  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const message = JSON.parse(line);

      if (message.class === "TPV") {
        publish("tpv", message);
      }

      if (message.class === "SKY") {
        publish("sky", message);
      }
    } catch (error) {
      console.error("Invalid gpsd message:", error.message);
    }
  }
});

gpsd.on("error", (error) => {
  console.error("gpsd error:", error.message);
});

gpsd.on("close", () => {
  console.log("gpsd connection closed");
});

function publish(topic, payload) {
  const fullTopic = `${TOPIC_BASE}/${topic}`;

  mqttClient.publish(fullTopic, JSON.stringify(payload), {
    qos: 0,
    retain: false,
  });
}
