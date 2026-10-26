import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { parseRecordContract } from '../../../lib/record-days';

export async function getStaticPaths() {
  return (await getCollection('experiments')).flatMap(experiment => {
    const contract = parseRecordContract(experiment.body, experiment.data.id);
    return contract ? contract.days.map(day => ({params: {slug: experiment.id, date: day.date}, props: {day}})) : [];
  });
}
export const GET: APIRoute = ({props}) => new Response(JSON.stringify(props.day), {headers: {'Content-Type': 'application/json; charset=utf-8'}});
