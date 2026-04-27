"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, null);

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form
        action={formAction}
        className="w-full max-w-sm flex flex-col gap-4 border border-gray-200 dark:border-gray-800 rounded-lg p-6"
      >
        <h1 className="text-xl font-bold">Admin</h1>
        <input
          type="password"
          name="password"
          placeholder="Password"
          required
          autoFocus
          className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded px-3 py-2"
        />
        <button
          type="submit"
          disabled={pending}
          className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50 hover:bg-blue-700 transition-colors"
        >
          {pending ? "..." : "Sign in"}
        </button>
        {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      </form>
    </main>
  );
}
