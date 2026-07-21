// Shared Twilio client + helper to send a text message.
import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function sendSms(toNumber, body) {
  return client.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to: toNumber,
    body,
    statusCallback: `${process.env.PUBLIC_BASE_URL}/api/webhook/sms-status`,
  });
}

export { client as twilioClient };
