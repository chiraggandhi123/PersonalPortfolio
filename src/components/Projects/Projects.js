import React from "react";
import { Container, Row, Col } from "react-bootstrap";
import ProjectCard from "./ProjectCards";
import BlogCard from "./BlogsCards";
import Particle from "../Particle";
import "../../style.css";
import "bootstrap/dist/css/bootstrap.min.css";

import covid from "../../Assets/Projects/covid19.jpg";
import bistro from "../../Assets/Projects/bistro.png";
import chatapp from "../../Assets/Projects/chatapp.png";
import twitter from "../../Assets/Projects/twitter.png";
import suicide from "../../Assets/Projects/suicide.png";
import algo from "../../Assets/Projects/algo.png";
import plant from "../../Assets/Projects/plant.jpeg";

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
              imgPath={covid}
              isBlog={false}
              title="Covid-19 Detection"
              description="Detecting Covid-19 along with other respiratory diseases like pneumonia using the siamese network.
              It involved creating a siamese resnet architecture and to train it from scratch to predict accurate results for 4 classes.
              Covid, SevereCovid, Normal, Pneumonia"
              link="#"
            />
          </Col>

          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={bistro}
              isBlog={false}
              title="BISTRO"
              description="A responsive resturant application completely build on react-framework and react-router for routing. The menu can be modified by just changing the 
              realtime-database Firebase."
              link="https://nostalgic-heyrovsky-9c3bd1.netlify.app/#/#/"
            />
          </Col>

          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={chatapp}
              isBlog={false}
              title="ChatApp"
              description="A real-time chat application build on above express and socket.io framework for peer to peer communication.
              The application is deployed on heroku."
              link="http://my-discord-clone.herokuapp.com/"
            />
          </Col>

          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={twitter}
              isBlog={false}
              title="Twitter-Clone"
              description="Created a fronted twitter clone, build entirely with the modern frameworks like react.js. The routes are managed through react-router. All the data is fetched thorugh Firebase real-time database."
              link="https://my-twitter-clone-v2.herokuapp.com/login"
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
