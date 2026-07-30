foreach (App\Models\Room::all() as $r) {
    echo $r->id . ": " . $r->name . PHP_EOL;
}
