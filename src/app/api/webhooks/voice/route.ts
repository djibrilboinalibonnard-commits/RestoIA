import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { sendSms } from "@/lib/sms";
import { storeCallRecording } from "@/lib/storage";
import { vapiProvider } from "@/server/voice/providers/vapi";
import { handleVoiceEvent } from "@/server/voice/webhook-handler";
import { notifyOwner } from "@/server/voice/notifications";
import { runPostCallAnalysis } from "@/server/voice/post-call";

/**
 * Webhook entrant de la couche vocale (Vapi).
 * Chemin critique de latence pour message.type = "tool-calls" : le client
 * attend au téléphone. Les effets lents partent dans after().
 */
export async function POST(request: NextRequest) {
  if (!vapiProvider.verifyWebhook(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const event = vapiProvider.parseWebhook(body);

  try {
    const { response, sideEffects } = await handleVoiceEvent(
      prisma,
      {
        sendSms: async (args) => {
          await sendSms(args);
        },
        notifyOwner,
        storeRecording: storeCallRecording,
        runPostCallAnalysis,
      },
      event,
    );

    if (sideEffects.length > 0) {
      after(async () => {
        for (const effect of sideEffects) {
          try {
            await effect();
          } catch (error) {
            console.error("[voice-webhook] effet différé en échec", error);
          }
        }
      });
    }

    return NextResponse.json(response ?? { ok: true });
  } catch (error) {
    console.error("[voice-webhook] erreur de traitement", error, {
      eventType: event.type,
    });
    // 200 avec consigne de repli pour ne pas casser l'appel en cours.
    return NextResponse.json({ ok: false });
  }
}
