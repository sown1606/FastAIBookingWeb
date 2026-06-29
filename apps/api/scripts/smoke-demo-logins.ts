type DemoRole = "SALON_OWNER" | "STAFF" | "CALL_CENTER_AGENT";

interface AuthUser {
  role?: string;
  salonId?: string | null;
  staffId?: string | null;
}

interface LoginResponse {
  success?: boolean;
  data?: {
    accessToken?: string;
    refreshToken?: string;
    user?: AuthUser;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

const baseUrl = (
  process.env.BASE_URL ??
  process.env.API_BASE_URL ??
  "https://api-new-nail.kendemo.com"
).replace(/\/$/, "");

const accounts = {
  owner: {
    email: "owner.demo@fastaibooking.local",
    password: "Owner123!",
    role: "SALON_OWNER" as DemoRole
  },
  staff: {
    email: "staff.demo@fastaibooking.local",
    password: "Staff123!",
    role: "STAFF" as DemoRole
  },
  agent: {
    email: "agent.demo@fastaibooking.local",
    password: "Agent123!",
    role: "CALL_CENTER_AGENT" as DemoRole
  }
};

const checks = [
  { name: "owner role login", path: "/api/v1/auth/login-owner", account: accounts.owner },
  { name: "staff role login", path: "/api/v1/auth/login-staff", account: accounts.staff },
  {
    name: "operator role login",
    path: "/api/v1/auth/login-call-center",
    account: accounts.agent
  },
  { name: "owner generic login", path: "/api/v1/auth/login", account: accounts.owner },
  { name: "staff generic login", path: "/api/v1/auth/login", account: accounts.staff },
  { name: "operator generic login", path: "/api/v1/auth/login", account: accounts.agent }
];

const parseJson = async (response: Response): Promise<LoginResponse> => {
  const text = await response.text();
  try {
    return JSON.parse(text) as LoginResponse;
  } catch {
    throw new Error(`Response was not JSON: ${text.slice(0, 300)}`);
  }
};

const assertLogin = async (check: (typeof checks)[number]): Promise<void> => {
  const response = await fetch(`${baseUrl}${check.path}`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Accept-Language": "vi-VN",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: check.account.email,
      password: check.account.password
    })
  });

  const payload = await parseJson(response);
  if (response.status !== 200) {
    throw new Error(
      `${check.name} returned ${response.status}: ${payload.error?.code ?? "NO_CODE"} ${
        payload.error?.message ?? ""
      }`.trim()
    );
  }

  const data = payload.data;
  if (!data?.accessToken || !data.refreshToken) {
    throw new Error(`${check.name} did not return both accessToken and refreshToken.`);
  }

  if (data.user?.role !== check.account.role) {
    throw new Error(
      `${check.name} returned role ${data.user?.role ?? "missing"} instead of ${check.account.role}.`
    );
  }

  if (check.account.role === "STAFF" && (!data.user.salonId || !data.user.staffId)) {
    throw new Error(`${check.name} did not return both salonId and staffId for staff login.`);
  }
};

const run = async (): Promise<void> => {
  const passed: string[] = [];

  for (const check of checks) {
    await assertLogin(check);
    passed.push(check.name);
    console.log(`${check.name}: ok`);
  }

  console.log(
    JSON.stringify(
      {
        baseUrl,
        passed: passed.length,
        total: checks.length
      },
      null,
      2
    )
  );
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
