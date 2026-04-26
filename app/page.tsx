import Link from "next/link";
import { CITIES } from "@/lib/cities";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="text-center max-w-2xl">
        <h1 className="text-5xl font-bold mb-4">Reddit Restaurants</h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
          Restaurant rankings sourced from real Reddit reviews. Food first, not
          service complaints.
        </p>
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
          {CITIES.map((city) => (
            <Link
              key={city.slug}
              href={`/${city.slug}`}
              className="rounded-lg border border-gray-200 dark:border-gray-800 p-6 hover:border-gray-400 dark:hover:border-gray-600 transition-colors"
            >
              <div className="font-semibold">{city.name}</div>
              <div className="text-sm text-gray-500 mt-1">{city.country}</div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
