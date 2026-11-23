/** Meta authentication template message: the code in the body and in the copy-code button. */
export function whatsappOtpPayload(phone: string, code: string, template: string, lang: string) {
  return {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: template,
      language: { code: lang },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
      ],
    },
  };
}

