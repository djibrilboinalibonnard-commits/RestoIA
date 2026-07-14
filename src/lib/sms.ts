import { env, isSmsConfigured } from "./env";

/**
 * Envoi de SMS transactionnels (confirmations client, notifications
 * commerçant) via l'API REST Twilio — sans SDK (un simple POST).
 * Sans configuration Twilio (dev), le SMS est loggé au lieu d'être envoyé.
 */
export async function sendSms(args: {
  to: string;
  body: string;
}): Promise<{ sent: boolean }> {
  if (!isSmsConfigured()) {
    console.log(`[sms:dev] → ${args.to} : ${args.body}`);
    return { sent: false };
  }

  const sid = env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN!}`).toString(
    "base64",
  );

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: args.to,
        From: env.TWILIO_SMS_FROM,
        Body: args.body,
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // Un SMS raté ne doit jamais faire échouer le flux d'appel — on logge.
    console.error(`[sms] échec Twilio ${response.status} : ${detail}`);
    return { sent: false };
  }
  return { sent: true };
}
