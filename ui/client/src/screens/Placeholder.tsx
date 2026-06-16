export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-prose text-sm text-gray-500">
        Цей екран заплановано у фазі <span className="font-medium text-gray-700">{phase}</span>.
        Зараз працює фундамент: live-стан рану, матриця перевірки та аудіо-шар у роботі.
      </p>
    </div>
  )
}
