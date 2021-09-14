import React from "react";
import { Container, Row, Col } from "react-bootstrap";
import ProjectCard from "./ProjectCards";
import BlogCard from "./BlogsCards";
import Particle from "../Particle";
import "../../style.css";
import "bootstrap/dist/css/bootstrap.min.css";

import covid from "../../Assets/Projects/covid19.jpg";
import buzzz from "../../Assets/Projects/buzzz.png";
import chatapp from "../../Assets/Projects/chatapp.png";
import twitter from "../../Assets/Projects/twitter.png";

function Projects() {
  return (
    <Container fluid className="project-section">
      <Particle />
      <Container>
        <h1 className="project-heading">
          My Recent <strong className="purple">Works </strong>
        </h1>
        <p style={{ color: "white" }}>
          Here are a few projects I've worked on recently.
        </p>
        <Row style={{ justifyContent: "center", paddingBottom: "10px" }}>

          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={buzzz}
              isBlog={false}
              title="Buzzz"
              description="
              A social media application completely build on MERN stack.
              It has all the basic functionalites like
              add/remove friend, 
              adding/commenting/deleting/like/dislike posts,
              It also has a moderator mode.
              "
              github_link="https://github.com/chirag-ttn/PROJECT_BACKEND"
              link="https://buzzz-1.herokuapp.com/"
            />
          </Col>

          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={chatapp}
              isBlog={false}
              title="ChatApp"
              description="A real-time chat application build on above express and socket.io framework for peer to peer communication.
              The application is deployed on heroku."
              github_link="https://github.com/chiraggandhi123/my-discord-clone"
              link="http://my-discord-clone.herokuapp.com/"
            />
          </Col>

          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={twitter}
              isBlog={false}
              title="Twitter-Clone"
              description="Created a fronted twitter clone, build entirely with the modern frameworks like react.js. The routes are managed through react-router. All the data is fetched thorugh Firebase real-time database."
              github_link = "https://github.com/chiraggandhi123/fullstack-twitter-clone"
              link="https://my-twitter-clone-v2.herokuapp.com/login"
            />
          </Col>
        <Col md={4} className="project-card">
          <ProjectCard
            imgPath={covid}
            isBlog={false}
            title="Covid-19 Detection"
            description="Detecting Covid-19 along with other respiratory diseases like pneumonia using the siamese network.
            It involved creating a siamese resnet architecture and to train it from scratch to predict accurate results for 4 classes.
            Covid, SevereCovid, Normal, Pneumonia"
            link="#"
          />
        </Col>

          
        </Row>
        {/* <h1 className="project-heading">
          My Recent <strong className="purple">Blog </strong> Posts
        </h1>
        <p style={{ color: "white" }}>Do give a read to some of my blogs</p>
        <Row style={{ justifyContent: "center" }}>
          <Col md={4} className="blog-card">
            <BlogCard
              imgPath={algo}
              link=""
              title="Cracking Interview"
              site="gitbook.com"
            />
          </Col>
          <Col md={4} className="blog-card">
            <BlogCard
              imgPath={plant}
              link="https://medium.com/jovianml/plant-ai-c8fc95ed90e6"
              title="Plant AI"
              site="medium.com"
            />
          </Col>
        </Row> */}
      </Container>
    </Container>
  );
}

export default Projects;
