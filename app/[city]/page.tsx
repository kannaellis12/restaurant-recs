import { notFound } from "next/navigation";
import { CITIES_BY_SLUG } from "@/lib/cities";
import { MOCK_RESTAURANTS_BY_CITY } from "@/lib/mock-data";
import { CityView } from "./CityView";

type PageProps = {
  params: Promise<{ city: string }>;
};

export async function generateStaticParams() {
  return Object.keys(CITIES_BY_SLUG).map((slug) => ({ city: slug }));
}

export default async function CityPage({ params }: PageProps) {
  const { city: slug } = await params;
  const city = CITIES_BY_SLUG[slug];
  if (!city) notFound();

  const restaurants = MOCK_RESTAURANTS_BY_CITY[slug] ?? [];

  return <CityView city={city} restaurants={restaurants} />;
}
