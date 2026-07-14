import { prisma } from "@/lib/db";
import { sendSms } from "@/lib/sms";

/**
 * Notification du commerçant (nouvelle réservation, message, annulation).
 * Phase 2 : SMS vers la ligne du commerce (contactPhone) si renseignée.
 * Phase 4 ajoutera le temps réel dashboard (SSE) et les préférences.
 */
export async function notifyOwner(args: {
  businessId: string;
  title: string;
  body: string;
}): Promise<void> {
  const business = await prisma.business.findUnique({
    where: { id: args.businessId },
    select: { contactPhone: true, name: true },
  });
  if (!business?.contactPhone) {
    console.log(`[notify:${args.businessId}] ${args.title} — ${args.body}`);
    return;
  }
  await sendSms({
    to: business.contactPhone,
    body: `[VoxEmploy] ${args.title} : ${args.body}`,
  });
}
