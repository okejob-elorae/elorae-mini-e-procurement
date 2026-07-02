import { auth, signOut } from "@/lib/auth";

export default async function PwaHome() {
  const session = await auth();
  const name = session?.user?.name ?? session?.user?.email ?? "Salesman";

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Hello, {name}</h1>
      <p className="text-sm text-muted-foreground">
        Elorae field sales — coming soon.
      </p>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button
          type="submit"
          className="rounded-md border px-4 py-2 hover:bg-muted"
        >
          Log out
        </button>
      </form>
    </main>
  );
}
