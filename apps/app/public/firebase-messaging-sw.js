self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = {};
  }

  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || data.title || "FastAIBooking";
  const body = notification.body || data.body || "";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/assets/brand/fastaibooking-mark.svg",
      data
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients
      .matchAll({
        type: "window",
        includeUncontrolled: true
      })
      .then((clients) => {
        const targetUrl = event.notification.data?.url || "/";
        const existingClient = clients.find((client) => "focus" in client);
        if (existingClient) {
          if ("navigate" in existingClient) {
            return existingClient.navigate(targetUrl).then((client) => client?.focus());
          }
          return existingClient.focus();
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
