// A shared vault loader works in Obsidian desktop and mobile WebViews.
return async app => {
  const base = "90 模板/订阅自动化/scripts";
  const load = async name => new Function(await app.vault.adapter.read(`${base}/${name}.js`))();
  const domain = await load("domain");
  const repository = (await load("repository"))(app, domain);
  const commands = (await load("commands"))(app, domain, repository);
  return { domain, repository, commands, load };
};
