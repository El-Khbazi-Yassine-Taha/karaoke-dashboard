<?php

namespace App\Http\Controllers;

use App\Models\Reservation;
use Carbon\Carbon;
use Illuminate\Http\Request;

class WebhookController extends Controller
{
    public function handleCalendly(Request $request)
    {
        if ($request->input('event') !== 'invitee.created') {
            return response()->json(['status' => 'ignored'], 200);
        }

        $payload = $request->input('payload', []);
        $startTime = Carbon::parse($payload['scheduled_event']['start_time'] ?? now());
        $endTime = Carbon::parse($payload['scheduled_event']['end_time'] ?? now()->addHour());

        $phone = $payload['text_reminder_number']
            ?? $this->answerFromQuestions($payload, ['phone', 'téléphone', 'telephone', 'number', 'numéro', 'numero'])
            ?? null;

        $members = $this->answerFromQuestions($payload, [
            'members',
            'guests',
            'party',
            'how many',
            'combien',
            'personnes',
            'people',
        ]);

        Reservation::updateOrCreate(
            ['calendly_uuid' => $payload['uri'] ?? $payload['uuid'] ?? null],
            [
                'room_name' => 'Room 1',
                'client_name' => $payload['name'] ?? 'Guest',
                'client_phone' => $phone,
                'client_email' => $payload['email'] ?? null,
                'members_count' => max(1, (int) preg_replace('/\D+/', '', (string) ($members ?? 1)) ?: 1),
                'check_in' => $startTime,
                'check_out' => $endTime,
                'date' => $startTime->toDateString(),
                'status' => 'confirmed',
            ]
        );

        return response()->json(['status' => 'success'], 200);
    }

    private function answerFromQuestions(array $payload, array $keywords): ?string
    {
        $questions = $payload['questions_and_answers'] ?? [];

        foreach ($questions as $qa) {
            $question = strtolower((string) ($qa['question'] ?? ''));
            $answer = trim((string) ($qa['answer'] ?? ''));

            if ($answer === '') {
                continue;
            }

            foreach ($keywords as $keyword) {
                if (str_contains($question, strtolower($keyword))) {
                    return $answer;
                }
            }
        }

        return null;
    }
}
