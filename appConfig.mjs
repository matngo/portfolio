import { Command } from "commander";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { opendir, readdir } from "fs/promises";
import _ from "lodash";
import path from "path";

export const SUPPORTED_LOCALES = ["en", "fr"];

const allowedImgExtensions = ["png", "webp", "jpg", "jpeg"];
function checkImgExtension(filename) {
  const ext = filename.split(".").pop();
  return allowedImgExtensions.find((e) => ext === e) ? filename : undefined;
}
function locateFileName(files, lookFor) {
  return files.find((v) => v.split(".")[0] === lookFor);
}

async function isEmpty(dir) {
  const files = await readdir(dir);
  return files.length < 1;
}

async function exploreImgDir(d) {
  const files = await readdir(d);

  if (files.length > 0) {
    const imagesInDir = files.map((name) => checkImgExtension(name));
    if (imagesInDir.length === 0)
      throw new Error(`Image directory ${d} has no images. Omitting`);
    else {
      const mainFilename = locateFileName(imagesInDir, "main");
      if (!mainFilename)
        throw Error(`Could not find main image in image directory ${d}`);
      const thumbnailFilename = locateFileName(imagesInDir, "thumbnail");
      const mainPath = path.join(d, mainFilename);

      const imgConfig = { include: true };
      imgConfig["main"] = mainPath;

      if (thumbnailFilename) {
        const thumbnailPath = path.join(d, thumbnailFilename);
        imgConfig["thumbnail"] = thumbnailPath;
      }
      const detailsFilenames = imagesInDir.filter((v) =>
        ["main", "thumbnail"].find((e) => e === v.split(".")[0]) ? 0 : 1,
      );
      if (detailsFilenames.length > 0) {
        imgConfig["details"] = {};
        for (const detailFile of detailsFilenames) {
          const fname = detailFile.split(".")[0];
          imgConfig["details"][fname] = path.join(d, fname);
        }
      }

      return imgConfig;
    }
  } else throw new Error("Image dir is empty");
}

async function exploreGallery(g) {
  console.log(`Parsing gallery ${g}`);
  const config = { include: true, images: {} };
  if (!(await isEmpty(g))) {
    for await (const d of await opendir(g)) {
      if (d.isDirectory()) {
        const imgDir = path.join(g, d.name);
        try {
          const image_config = await exploreImgDir(imgDir);
          config.images[d.name] = image_config;
        } catch (error) {
          console.log(error.message);
        }
      } else {
        if (checkImgExtension(d.name)) {
          config["images"][d.name.split(".")[0]] = {
            path: path.join(g, d.name),
            include: true,
          };
        }
      }
    }
    return config;
  } else throw new Error("Empty gallery");
}

async function* walkGalleries(dir) {
  for await (const d of await opendir(dir)) {
    if (d.isDirectory()) {
      const gallery = path.join(dir, d.name);
      const g = await exploreGallery(gallery);
      yield { [d.name]: g };
    }
  }
}

async function generateGalleryConfig(dir, configFile) {
  let galleries = {};
  for await (const gallery of walkGalleries(dir)) {
    galleries = { ...galleries, ...gallery };
  }

  if (existsSync(configFile)) {
    const oldConfig = JSON.parse(readFileSync(configFile, "utf-8"));
    _.merge(galleries, oldConfig);

    const newConf = sanitizeConfig(galleries);

    writeFileSync(configFile, JSON.stringify(newConf), "utf-8", (err) => {
      if (err) console.log(err.message);
    });
  } else {
    writeFileSync(configFile, JSON.stringify(galleries), "utf-8", (err) => {
      if (err) console.log(err.message);
    });
  }
}

function sanitizeConfig(conf) {
  let keyPath;
  let newConf = { ...conf };

  for (const gallery of Object.keys(conf)) {
    for (const imageKey of Object.keys(conf[gallery]["images"])) {
      keyPath = `${gallery}.images.${imageKey}`;
      const image = conf[gallery]["images"][imageKey];

      if ("path" in image && !existsSync(image["path"])) {
        newConf = _.omit(newConf, keyPath);
      } else if ("mainPath" in image) {
        if (!existsSync(image["mainPath"])) {
          newConf = _.omit(newConf, keyPath);
        }
        if ("detailsPath" in image) {
          for (let i = 0; i < image["detailsPath"].length; i++) {
            if (!existsSync(image["detailsPath"][i])) {
              const detailKeyPath = keyPath + `.detailsPath[${i}]`;
              newConf = _.omit(newConf, detailKeyPath);
            }
          }
          if (_.isEmpty(conf[gallery]["images"][imageKey]["details"]))
            newConf = _.omit(newConf, keyPath + ".[details]");
        }
      }
    }
    if (Object.keys(conf[gallery]["images"]).length === 0)
      newConf = _.omit(newConf, gallery);
  }

  return newConf;
}

function newImageMessage() {
  return { title: "", alt: "", description: "" };
}

function generateMessages(dir, source) {
  const conf = JSON.parse(readFileSync(source, "utf-8"));

  for (const locale of SUPPORTED_LOCALES) {
    const messages = {};
    for (const gallery of Object.keys(conf)) {
      messages[gallery] = {};

      const images = conf[gallery]["images"];
      for (const imgKey of Object.keys(images)) {
        if ("path" in images[imgKey]) {
          messages[gallery][imgKey] = newImageMessage();
        } else {
          messages[gallery][imgKey] = { main: newImageMessage() };
          if ("thumbnail" in images[imgKey]) {
            messages[gallery][imgKey]["thumbnail"] = newImageMessage();
          }

          if ("details" in images[imgKey]) {
            for (const detail of Object.keys(images[imgKey]["details"])) {
              messages[gallery][imgKey][detail] = newImageMessage();
            }
          }
        }
      }
    }
    const localeMessages = path.join(dir, `${locale}.json`);
    if (existsSync(localeMessages)) {
      try {
        const oldMessages = JSON.parse(readFileSync(localeMessages));

        oldMessages["galleries"] = _.merge(messages, oldMessages["galleries"]);
        writeFileSync(localeMessages, JSON.stringify(oldMessages), "utf-8");
      } catch (e) {
        console.log(e);
      }
    } else {
      writeFileSync(
        localeMessages,
        JSON.stringify({ galleries: messages }),
        "utf-8",
      );
    }
  }
}

const program = new Command();

program
  .name("portfolio-utils")
  .description("CLI pour générer ")
  .version("0.8.0");

program
  .command("generate")
  .description(
    "Genère le fichier de configuration de l'application en se basant sur les dossiers dans ./public/galleries",
  )
  .option("-d, --dir <string>", "Emplacement des images", "./public/galleries")
  .option(
    "-f, --file <string>",
    "Emplacement du fichier de configuration à générer",
    "./src/app/appData.json",
  )
  .option(
    "-p, --purge <string>",
    "Enlève les images non utilisées du fichier de config",
  )
  .action((options) =>
    generateGalleryConfig(options.dir, options.file, "test").then((v) => {}),
  );

program
  .command("generateMessages")
  .description(
    "Genère les différents fichiers pour la gestion des messages et textes des galeries",
  )
  .option("-d, --dir <string>", "Root des différentes locales", "./messages/")
  .option(
    "-s, --source <string>",
    "Emplacement du fichier de configuration à partir duquel générer les messages",
    "./src/app/appData.json",
  )
  .action((options) => generateMessages(options.dir, options.source));

program.parse();
